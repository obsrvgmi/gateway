import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { ASSETS, ASSET_SYMBOLS } from "@/lib/assets";
import type { AssetSymbol } from "@/lib/types";
import { db, schema } from "../db";
import { conflict, notFound } from "../http/errors";
import { hasUnverifiableRoute, pausedRoutes, routeMinimumUsd } from "./guards";

export type Organization = typeof schema.organizations.$inferSelect;
export type LinkRow = typeof schema.paymentLinks.$inferSelect;
export type WidgetRow = typeof schema.widgets.$inferSelect;

export type Source =
  | { kind: "link"; id: string; name: string; org: Organization; link: LinkRow; amount: number | null; receiveAsset: AssetSymbol; accepted: AssetSymbol[] }
  | { kind: "widget"; id: string; name: string; org: Organization; widget: WidgetRow; amount: number | null; receiveAsset: AssetSymbol; accepted: AssetSymbol[] };

const toAmount = (value: string | null) => (value === null ? null : Number(value));

/** A link or widget by its public id. Deleted ones don't exist as far as a customer can tell. */
export async function loadSource(id: string): Promise<Source> {
  if (id.startsWith("lnk_")) {
    const [row] = await db()
      .select({ link: schema.paymentLinks, org: schema.organizations })
      .from(schema.paymentLinks)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.paymentLinks.orgId))
      .where(and(eq(schema.paymentLinks.id, id), isNull(schema.paymentLinks.deletedAt)))
      .limit(1);
    if (row) return { kind: "link", id, name: row.link.title, org: row.org, link: row.link, amount: toAmount(row.link.amountUsd), receiveAsset: row.link.receiveAsset as AssetSymbol, accepted: ASSET_SYMBOLS };
  }
  if (id.startsWith("wgt_")) {
    const [row] = await db()
      .select({ widget: schema.widgets, org: schema.organizations })
      .from(schema.widgets)
      .innerJoin(schema.organizations, eq(schema.organizations.id, schema.widgets.orgId))
      .where(and(eq(schema.widgets.id, id), isNull(schema.widgets.deletedAt)))
      .limit(1);
    if (row) return { kind: "widget", id, name: row.widget.name, org: row.org, widget: row.widget, amount: toAmount(row.widget.amountUsd), receiveAsset: row.widget.receiveAsset as AssetSymbol, accepted: row.widget.acceptedAssets as AssetSymbol[] };
  }
  throw notFound("This payment page isn't available.");
}

/** Why this source can't take a payment right now, or null when it can. */
export function closedReason(source: Source, now = Date.now()): string | null {
  if (!source.org.walletAddress) return "This merchant isn't ready to take payments yet.";
  if (source.kind === "link") {
    if (source.link.status === "paused") return "This link is paused.";
    if (source.link.status === "expired" || (source.link.expiresAt && source.link.expiresAt.getTime() <= now)) return "This link has expired.";
  } else if (source.widget.status === "paused") {
    return "This checkout is paused.";
  }
  return null;
}

export function assertOpen(source: Source) {
  const reason = closedReason(source);
  if (reason) throw conflict(reason, "source_closed");
}

/** Where a payment goes: the merchant's own wallet, either as an Intents balance or on its chain. */
export function settlementTarget(org: Organization, receiveAsset: AssetSymbol) {
  if (!org.walletAddress) throw conflict("This merchant isn't ready to take payments yet.", "source_closed");
  if (org.settlementMode === "balance") return { recipient: org.walletAddress, recipientType: "INTENTS" as const };
  // Direct mode pays the verified wallet and nothing else, so a stolen session has no address to swap in.
  if (ASSETS[receiveAsset].addressKind !== "evm") throw conflict(`Direct settlement only supports EVM assets, so ${receiveAsset} needs a settlement balance.`, "receive_asset_unsupported");
  return { recipient: org.walletAddress, recipientType: "DESTINATION_CHAIN" as const };
}

export interface PayOption {
  symbol: AssetSymbol;
  name: string;
  chain: string;
  /** Lowest USD amount this route can fill, zero when there is none. */
  minimumUsd: number;
  paused: boolean;
}

/** The pay assets this source accepts, with what limits each. The customer sees why one is unavailable. */
export async function payOptions(source: Source): Promise<PayOption[]> {
  const paused = await pausedRoutes();
  const recipientType = source.org.settlementMode === "balance" ? "INTENTS" : "DESTINATION_CHAIN";
  return source.accepted.map((symbol) => {
    const asset = ASSETS[symbol];
    return {
      symbol,
      name: asset.name,
      chain: asset.chain,
      minimumUsd: routeMinimumUsd(symbol, recipientType),
      paused: hasUnverifiableRoute([symbol, source.receiveAsset]) || paused.has("payments") || paused.has(`asset:${symbol}`) || paused.has(`chain:${asset.blockchain}`) || paused.has(`asset:${source.receiveAsset}`) || paused.has(`chain:${ASSETS[source.receiveAsset].blockchain}`),
    };
  });
}

/** Everything a customer's browser may see about a source. Nothing internal to the merchant. */
export async function publicSource(source: Source) {
  const { branding, businessName } = source.org;
  const common = {
    id: source.id,
    kind: source.kind,
    merchant: businessName,
    amount: source.amount,
    receiveAsset: source.receiveAsset,
    supportEmail: branding.supportEmail,
    statementName: branding.statementName,
    closedReason: closedReason(source),
    options: await payOptions(source),
  };
  if (source.kind === "link") {
    return { ...common, title: source.link.title, description: source.link.description, accent: branding.accent, successUrl: source.link.successUrl };
  }
  const { widget } = source;
  return {
    ...common,
    merchant: widget.displayName || businessName,
    title: widget.name,
    description: "",
    accent: widget.accent,
    theme: widget.theme,
    radius: widget.radius,
    buttonLabel: widget.buttonLabel,
    showBranding: widget.showBranding,
    presets: widget.presets,
    logo: widget.logo,
    collectEmail: widget.collectEmail,
    success: widget.success,
    site: widget.site,
  };
}
