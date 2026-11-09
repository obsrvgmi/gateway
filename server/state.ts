import "server-only";
import { and, desc, eq, gte, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { ApiKey, AppNotification, AssetSymbol, GatewayState, PaymentLink, Settings, TeamMember, TeamRole, Webhook, WebhookEvent, Widget, WidgetRadius, WidgetSuccess, WidgetTheme } from "@/lib/types";
import { db, schema } from "./db";
import { paymentsMode } from "./env";
import { notFound } from "./http/errors";
import { settlementSummary } from "./payments/availability";
import { toPayment, toPayout } from "./payments/serialize";
import { prices } from "./payments/tokens";

const PAYMENT_LIMIT = 10_000;
/** Before anything has happened, a checkout attempt isn't a payment. */
const HIDDEN_STATES = ["quoting", "quote_failed", "awaiting_deposit"];
/** A payout nobody signed never existed, as far as the merchant's history is concerned. */
const HIDDEN_PAYOUT_STATES = ["awaiting_signature", "expired"];

type LinkRow = typeof schema.paymentLinks.$inferSelect;
type WidgetRow = typeof schema.widgets.$inferSelect;
type OrgRow = typeof schema.organizations.$inferSelect;

export function toLink(row: LinkRow): PaymentLink {
  const expired = row.status === "expired" || (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now());
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    amount: row.amountUsd === null ? null : Number(row.amountUsd),
    receiveAsset: row.receiveAsset as AssetSymbol,
    status: expired ? "expired" : (row.status as PaymentLink["status"]),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    successUrl: row.successUrl,
    metadata: row.metadata,
    singleUse: row.singleUse,
    publicStats: row.publicStats,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toWidget(row: WidgetRow): Widget {
  return {
    id: row.id,
    name: row.name,
    site: row.site,
    status: row.status as Widget["status"],
    theme: row.theme as WidgetTheme,
    accent: row.accent,
    radius: row.radius as WidgetRadius,
    amount: row.amountUsd === null ? null : Number(row.amountUsd),
    receiveAsset: row.receiveAsset as AssetSymbol,
    buttonLabel: row.buttonLabel,
    showBranding: row.showBranding,
    acceptedAssets: row.acceptedAssets as AssetSymbol[],
    presets: row.presets,
    displayName: row.displayName,
    logo: row.logo,
    collectEmail: row.collectEmail,
    success: row.success as WidgetSuccess,
    publicStats: row.publicStats,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function teamOf(orgId: string): Promise<TeamMember[]> {
  const members = await db().select({ user: schema.users, membership: schema.memberships }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(eq(schema.memberships.orgId, orgId)).orderBy(schema.memberships.createdAt);
  const invites = await db().select().from(schema.invites).where(and(eq(schema.invites.orgId, orgId), isNull(schema.invites.acceptedAt), isNull(schema.invites.revokedAt), gte(schema.invites.expiresAt, new Date())));
  return [
    ...members.map(({ user, membership }): TeamMember => ({ id: user.id, name: user.name || user.email.split("@")[0], email: user.email, role: membership.role as TeamRole, status: "active", createdAt: membership.createdAt.toISOString() })),
    ...invites.map((invite): TeamMember => ({ id: invite.id, name: "Invited teammate", email: invite.email, role: invite.role as TeamRole, status: "invited", createdAt: invite.createdAt.toISOString() })),
  ];
}

export async function settingsOf(org: OrgRow): Promise<Settings> {
  const [destinations, keys, hooks, team] = await Promise.all([
    db().select().from(schema.destinations).where(and(eq(schema.destinations.orgId, org.id), isNull(schema.destinations.removedAt))).orderBy(schema.destinations.createdAt),
    db().select().from(schema.apiKeys).where(and(eq(schema.apiKeys.orgId, org.id), isNull(schema.apiKeys.revokedAt))).orderBy(desc(schema.apiKeys.createdAt)),
    db().select().from(schema.webhooks).where(and(eq(schema.webhooks.orgId, org.id), isNull(schema.webhooks.deletedAt))).orderBy(desc(schema.webhooks.createdAt)),
    teamOf(org.id),
  ]);
  const fallback = destinations[0];
  const defaultDestination = destinations.find((item) => item.id === org.defaultDestinationId) ?? fallback;
  return {
    businessName: org.businessName,
    receiveAsset: org.receiveAsset as AssetSymbol,
    walletAddress: defaultDestination?.address ?? org.walletAddress ?? "",
    apiKeys: keys.map((key): ApiKey => ({ id: key.id, label: key.label, prefix: key.prefix, createdAt: key.createdAt.toISOString() })),
    webhooks: hooks.map((hook): Webhook => ({ id: hook.id, url: hook.url, events: hook.events as WebhookEvent[], enabled: hook.enabled, createdAt: hook.createdAt.toISOString() })),
    team,
    branding: org.branding,
    notifications: org.notifications,
    payouts: {
      schedule: org.payoutSchedule as Settings["payouts"]["schedule"],
      holdDays: org.holdDays,
      minimumUsd: Number(org.minimumUsd),
      destinations: destinations.map((item) => ({ id: item.id, label: item.label, address: item.address })),
      defaultDestinationId: defaultDestination?.id ?? "",
    },
  };
}

const toNotification = (row: typeof schema.notifications.$inferSelect): AppNotification => ({ id: row.id, kind: row.kind, title: row.title, body: row.body, href: row.href, createdAt: row.createdAt.toISOString(), read: row.readAt !== null });

const recentNotifications = (orgId: string) => db().select().from(schema.notifications).where(eq(schema.notifications.orgId, orgId)).orderBy(desc(schema.notifications.createdAt)).limit(50);

export async function loadOrgRow(orgId: string) {
  const [org] = await db().select().from(schema.organizations).where(eq(schema.organizations.id, orgId)).limit(1);
  if (!org) throw notFound();
  return org;
}

/** Everything the dashboard needs for one workspace. */
export async function loadState(orgId: string, me: GatewayState["me"]): Promise<GatewayState> {
  const org = await loadOrgRow(orgId);
  const [links, widgets, payments, payouts, settings, settlement, priced, notifications] = await Promise.all([
    db().select().from(schema.paymentLinks).where(and(eq(schema.paymentLinks.orgId, orgId), isNull(schema.paymentLinks.deletedAt))).orderBy(desc(schema.paymentLinks.createdAt)),
    db().select().from(schema.widgets).where(and(eq(schema.widgets.orgId, orgId), isNull(schema.widgets.deletedAt))).orderBy(desc(schema.widgets.createdAt)),
    db().select().from(schema.payments).where(and(eq(schema.payments.orgId, orgId), notInArray(schema.payments.state, HIDDEN_STATES))).orderBy(desc(schema.payments.createdAt)).limit(PAYMENT_LIMIT + 1),
    db().select().from(schema.payouts).where(and(eq(schema.payouts.orgId, orgId), notInArray(schema.payouts.state, HIDDEN_PAYOUT_STATES))).orderBy(desc(schema.payouts.createdAt)).limit(2000),
    settingsOf(org),
    settlementSummary(org),
    prices(),
    recentNotifications(orgId),
  ]);
  return {
    links: links.map(toLink),
    widgets: widgets.map(toWidget),
    payments: payments.slice(0, PAYMENT_LIMIT).map(toPayment),
    paymentsTruncated: payments.length > PAYMENT_LIMIT,
    payouts: payouts.map(toPayout),
    settings,
    setupDismissed: org.setupDismissed,
    me,
    mode: paymentsMode(),
    settlement,
    prices: priced,
    notifications: notifications.map(toNotification),
  };
}

/** Only what moved since `since`, so a busy merchant's dashboard doesn't re-download its whole history. */
export async function loadChanges(orgId: string, since: Date) {
  const org = await loadOrgRow(orgId);
  const [payments, payouts, settlement, notifications] = await Promise.all([
    db().select().from(schema.payments).where(and(eq(schema.payments.orgId, orgId), gte(schema.payments.updatedAt, since), notInArray(schema.payments.state, HIDDEN_STATES))).orderBy(desc(schema.payments.updatedAt)).limit(500),
    db().select().from(schema.payouts).where(and(eq(schema.payouts.orgId, orgId), gte(schema.payouts.updatedAt, since), notInArray(schema.payouts.state, HIDDEN_PAYOUT_STATES))).limit(200),
    settlementSummary(org),
    recentNotifications(orgId),
  ]);
  return { payments: payments.map(toPayment), payouts: payouts.map(toPayout), settlement, notifications: notifications.map(toNotification), at: new Date().toISOString() };
}

export const countPayments = async (orgId: string, sourceIds: string[]) => (sourceIds.length ? db().select({ sourceId: schema.payments.sourceId, count: sql<number>`count(*)` }).from(schema.payments).where(and(eq(schema.payments.orgId, orgId), inArray(schema.payments.sourceId, sourceIds))).groupBy(schema.payments.sourceId) : []);
