import "server-only";
import { and, eq, gt, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { nextPayoutAt } from "@/lib/payouts";
import type { PayoutSchedule } from "@/lib/types";
import { db, schema, type Tx } from "./db";
import { sendEmail } from "./email";
import { env } from "./env";
import { newId } from "./ids";
import { log } from "./log";
import { notify } from "./notify";
import { computeAvailable, heldAmounts, inFlightAmounts, readBalances } from "./payments/availability";
import { screeningKey } from "./payments/guards";
import { baseToNumber } from "@/lib/money";
import { prices } from "./payments/tokens";

type OutboxRow = typeof schema.outbox.$inferSelect;
type Org = typeof schema.organizations.$inferSelect;

const usd = (value: unknown) => `$${Number(value ?? 0).toFixed(2)}`;
const paymentHref = (id: unknown) => `/dashboard/payments?q=${String(id)}`;

/** What each event says to the merchant. `pref` is the alert setting that controls its email. */
function describe(event: OutboxRow): { kind: string; title: string; body?: string; href: string; pref?: keyof Org["notifications"]; always?: boolean } | null {
  const data = event.payload as Record<string, unknown>;
  const source = (data.source as { name?: string } | undefined)?.name ?? "a payment";
  switch (event.type) {
    case "payment.settled":
      return { kind: "payment", title: `${usd(data.amount_usd)} received`, body: `From ${source}.`, href: paymentHref(data.id), pref: "settled" };
    case "payment.processing":
      return { kind: "payment", title: `${usd(data.amount_usd)} on its way`, body: `A customer paid ${source}.`, href: paymentHref(data.id), pref: "processing" };
    case "payment.refunded":
      return { kind: "refund", title: `Refund completed`, body: `${source}.`, href: paymentHref(data.id), pref: "refunded" };
    case "payment.expired":
      return { kind: "payment", title: "A customer didn't finish paying", body: `${source}, ${usd(data.amount_usd)}.`, href: paymentHref(data.id), pref: "expired" };
    case "payment.failed":
      return { kind: "payment", title: "A payment didn't complete", body: `${source}, ${usd(data.amount_usd)}. The customer's funds are returned by the route.`, href: paymentHref(data.id), always: true };
    case "payout.sent":
      return { kind: "payout", title: "Payout sent", href: "/dashboard/payouts" };
    case "payout.failed":
      return { kind: "payout", title: "A payout failed", body: String(data.reason ?? ""), href: "/dashboard/payouts", always: true };
    case "alert.wallet_changed":
      return { kind: "alert", title: "Settlement wallet changed", body: `All new payments now go to ${String(data.to)}.`, href: "/dashboard/settings?tab=business", always: true };
    case "alert.destination_added":
      return { kind: "alert", title: "Payout destination added", body: `${String(data.label)}: ${String(data.address)}.`, href: "/dashboard/payouts#destinations", always: true };
    case "alert.deposit_changed":
      return { kind: "alert", title: "A payment's deposit changed after it finished", body: "A second deposit may have reached a used address. Contact support with this payment's id.", href: paymentHref(data.id), always: true };
    default:
      return null;
  }
}

const NOT_WEBHOOKS = /^alert\./;

/** Turns committed events into webhook deliveries, notifications and emails. */
export async function processOutbox(limit = 50) {
  const emails: { orgId: string; title: string; body: string; href: string; admins: boolean }[] = [];
  const count = await db().transaction(async (tx) => {
    const rows = await tx.select().from(schema.outbox).where(isNull(schema.outbox.processedAt)).orderBy(schema.outbox.id).limit(limit).for("update", { skipLocked: true });
    for (const event of rows) {
      await fanOut(tx, event, emails);
      await tx.update(schema.outbox).set({ processedAt: new Date() }).where(eq(schema.outbox.id, event.id));
    }
    return rows.length;
  });
  // Outside the transaction: a mail outage must not stop webhooks, and it can't undo a commit.
  for (const email of emails) await sendTeamEmail(email);
  return count;
}

async function fanOut(tx: Tx, event: OutboxRow, emails: { orgId: string; title: string; body: string; href: string; admins: boolean }[]) {
  if (!NOT_WEBHOOKS.test(event.type)) {
    const hooks = await tx.select().from(schema.webhooks).where(and(eq(schema.webhooks.orgId, event.orgId), eq(schema.webhooks.enabled, true), isNull(schema.webhooks.deletedAt)));
    const eventId = `evt_${event.id}`;
    const body = JSON.stringify({ id: eventId, type: event.type, created_at: event.createdAt.toISOString(), data: event.payload });
    for (const hook of hooks) {
      if (!hook.events.includes(event.type)) continue;
      await tx.insert(schema.webhookDeliveries).values({ id: newId("whd_"), webhookId: hook.id, orgId: event.orgId, eventId, type: event.type, body, nextAttemptAt: new Date() }).onConflictDoNothing();
    }
  }
  const described = describe(event);
  if (!described) return;
  await notify(tx, { orgId: event.orgId, kind: described.kind, title: described.title, body: described.body, href: described.href });
  const [org] = await tx.select({ notifications: schema.organizations.notifications }).from(schema.organizations).where(eq(schema.organizations.id, event.orgId)).limit(1);
  if (described.always || (described.pref && org?.notifications[described.pref])) emails.push({ orgId: event.orgId, title: described.title, body: described.body ?? "", href: described.href, admins: true });
}

async function sendTeamEmail(input: { orgId: string; title: string; body: string; href: string }) {
  const people = await db().select({ email: schema.users.email }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(and(eq(schema.memberships.orgId, input.orgId), inArray(schema.memberships.role, ["owner", "admin", "finance"])));
  for (const person of people) {
    await sendEmail({ to: person.email, subject: input.title, text: `${input.title}\n\n${input.body}\n\n${env().APP_URL}${input.href}` }).catch((error) => log("error", "notification email failed", { error }));
  }
}

/** A payout prompt, not a payout: only the merchant's wallet can sign one. */
export async function promptScheduledPayouts(now = Date.now()) {
  const orgs = await db().select().from(schema.organizations).where(ne(schema.organizations.payoutSchedule, "manual"));
  let sent = 0;
  for (const org of orgs) {
    if (!org.walletAddress) continue;
    const last = org.lastScheduledPromptAt?.getTime() ?? org.createdAt.getTime();
    const due = nextPayoutAt(org.payoutSchedule as PayoutSchedule, last);
    if (due === null || due > now) continue;
    try {
      const [balances, held, moving, priced] = await Promise.all([readBalances(org.walletAddress), heldAmounts(org, now), inFlightAmounts(org.id), prices()]);
      const available = computeAvailable(balances, held, moving);
      let total = 0;
      for (const [asset, amount] of available) total += baseToNumber(amount, asset) * (priced[asset] ?? 0);
      await db().update(schema.organizations).set({ lastScheduledPromptAt: new Date(now) }).where(eq(schema.organizations.id, org.id));
      if (total <= 0 || total < Number(org.minimumUsd)) continue;
      await notify(db(), { orgId: org.id, kind: "payout", title: `${usd(total)} is ready to pay out`, body: "Your scheduled payout needs your wallet's signature.", href: "/dashboard/payouts?pay=1" });
      await sendTeamEmail({ orgId: org.id, title: `${usd(total)} is ready to pay out`, body: "Your scheduled payout needs your wallet's signature. Gateway never holds a key, so it can't send this for you.", href: "/dashboard/payouts?pay=1" });
      sent += 1;
    } catch (error) {
      log("warn", "scheduled payout prompt failed", { orgId: org.id, error });
    }
  }
  return sent;
}

const WEEK = 7 * 86_400_000;

export async function noticeExpiringLinks(now = Date.now()) {
  const rows = await db()
    .select({ link: schema.paymentLinks, prefs: schema.organizations.notifications })
    .from(schema.paymentLinks)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.paymentLinks.orgId))
    .where(and(eq(schema.paymentLinks.status, "active"), isNull(schema.paymentLinks.deletedAt), isNull(schema.paymentLinks.expiryNoticeAt), gt(schema.paymentLinks.expiresAt, new Date(now)), lte(schema.paymentLinks.expiresAt, new Date(now + WEEK))));
  for (const { link, prefs } of rows) {
    await db().update(schema.paymentLinks).set({ expiryNoticeAt: new Date(now) }).where(eq(schema.paymentLinks.id, link.id));
    await notify(db(), { orgId: link.orgId, kind: "link", title: "A link expires this week", body: link.title, href: `/dashboard/links/${link.id}` });
    if (prefs.links) await sendTeamEmail({ orgId: link.orgId, title: "A link expires this week", body: link.title, href: `/dashboard/links/${link.id}` });
  }
  return rows.length;
}

const SANCTIONS_BASE = "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists";
const SANCTIONS_LISTS = ["ETH", "XBT", "SOL", "TRX", "ARB", "BSC", "USDT", "USDC"];

/**
 * Daily copy of the OFAC digital-currency addresses, from a public mirror of the SDN list. Only adds:
 * a failed or partial fetch can't empty the list, and an address that comes off it is removed by hand.
 */
export async function refreshSanctionsList(fetcher: typeof fetch = fetch) {
  let added = 0;
  for (const name of SANCTIONS_LISTS) {
    try {
      const response = await fetcher(`${SANCTIONS_BASE}/sanctioned_addresses_${name}.txt`, { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const addresses = (await response.text()).split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).map(screeningKey);
      if (!addresses.length) continue;
      for (let i = 0; i < addresses.length; i += 500) {
        const result = await db().insert(schema.screenedAddresses).values(addresses.slice(i, i + 500).map((address) => ({ address, source: `ofac:${name}` }))).onConflictDoNothing().returning({ address: schema.screenedAddresses.address });
        added += result.length;
      }
    } catch (error) {
      log("error", "sanctions list refresh failed", { list: name, error });
    }
  }
  return added;
}

/** Money that has been moving for hours needs a person, whatever the provider says. */
export async function reportStuck(now = Date.now()) {
  const limit = new Date(now - 6 * 3_600_000);
  const rows = await db().select({ id: schema.payments.id, state: schema.payments.state, createdAt: schema.payments.createdAt, status: schema.payments.providerStatus }).from(schema.payments).where(and(inArray(schema.payments.state, ["deposit_seen", "processing", "incomplete_deposit", "failed"]), lte(schema.payments.updatedAt, new Date(now)), lte(schema.payments.createdAt, limit))).limit(50);
  if (rows.length) log("error", "payments stuck in flight", { count: rows.length, ids: rows.map((row) => row.id) });
  return rows.length;
}

export async function beat(name: string) {
  await db().insert(schema.heartbeats).values({ name, at: new Date() }).onConflictDoUpdate({ target: schema.heartbeats.name, set: { at: new Date() } });
}

export async function purgeExpired() {
  await db().execute(sql`delete from rate_limits where window_start < now() - interval '1 day'`);
  await db().execute(sql`delete from login_tokens where expires_at < now() - interval '1 day'`);
  await db().execute(sql`delete from sessions where expires_at < now()`);
  await db().execute(sql`delete from idempotency_keys where created_at < now() - interval '7 days'`);
}
