import "server-only";
import { and, eq, gte, inArray, lt, notInArray, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { provider } from "./payments/provider";
import { dashboardStatus, UNPAID_STATES, type PaymentState } from "./payments/state-machine";

/** Settled, as the dashboard counts it: money arrived, including a payment whose refund is under way. */
const SETTLED_STATES: PaymentState[] = ["settled", "refund_pending"];

/** Payments in the current mode only, so test-mode rows never add to real totals. */
const currentMode = () => provider().kind === "oneclick";

/**
 * What the merchant's own server sees: the dashboard's figures for a window, from the database. Success
 * rate leaves in-flight payments out of the denominator, as the dashboard does.
 */
export async function merchantStats(orgId: string, filter: { since?: Date; until?: Date; sourceId?: string }) {
  const live = currentMode();
  const rows = await db()
    .select({ state: schema.payments.state, asset: schema.payments.payAsset, count: sql<number>`count(*)::int`, usd: sql<string>`coalesce(sum(${schema.payments.usd}), 0)` })
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.orgId, orgId),
        eq(schema.payments.live, live),
        notInArray(schema.payments.state, UNPAID_STATES),
        filter.sourceId ? eq(schema.payments.sourceId, filter.sourceId) : undefined,
        filter.since ? gte(schema.payments.createdAt, filter.since) : undefined,
        filter.until ? lt(schema.payments.createdAt, filter.until) : undefined,
      ),
    )
    .groupBy(schema.payments.state, schema.payments.payAsset);

  const payments = { total: 0, settled: 0, processing: 0, refunded: 0, failed: 0, expired: 0 };
  const byAsset = new Map<string, { asset: string; volume_usd: number; payments: number }>();
  let volume = 0;
  for (const row of rows) {
    const status = dashboardStatus(row.state as PaymentState);
    payments.total += row.count;
    payments[status] += row.count;
    if (status !== "settled") continue;
    const usd = Number(row.usd);
    volume += usd;
    const entry = byAsset.get(row.asset) ?? { asset: row.asset, volume_usd: 0, payments: 0 };
    entry.volume_usd = round(entry.volume_usd + usd);
    entry.payments += row.count;
    byAsset.set(row.asset, entry);
  }
  const resolved = payments.total - payments.processing;
  return {
    live,
    since: filter.since?.toISOString() ?? null,
    until: filter.until?.toISOString() ?? null,
    currency: "USD",
    volume_usd: round(volume),
    payments,
    success_rate: resolved ? payments.settled / resolved : null,
    by_pay_asset: [...byAsset.values()].sort((a, b) => b.volume_usd - a.volume_usd),
  };
}

/**
 * A public counter is polled by every visitor of the page it sits on, so each source's figures are kept
 * for a few seconds. Per process, which is enough: a counter a few seconds behind is still right.
 */
const PUBLIC_TTL_MS = 10_000;
const publicCache = new Map<string, { at: number; value: Awaited<ReturnType<typeof readPublicTotals>> }>();

export async function publicTotals(orgId: string, sourceId: string) {
  const key = `${orgId}:${sourceId}:${currentMode()}`;
  const hit = publicCache.get(key);
  if (hit && Date.now() - hit.at < PUBLIC_TTL_MS) return hit.value;
  const value = await readPublicTotals(orgId, sourceId);
  if (publicCache.size > 10_000) publicCache.clear();
  publicCache.set(key, { at: Date.now(), value });
  return value;
}

/** A public counter's figures: settled total and count, nothing about who paid. */
async function readPublicTotals(orgId: string, sourceId: string) {
  const live = currentMode();
  const [row] = await db()
    .select({ count: sql<number>`count(*)::int`, usd: sql<string>`coalesce(sum(${schema.payments.usd}), 0)` })
    .from(schema.payments)
    .where(and(eq(schema.payments.orgId, orgId), eq(schema.payments.sourceId, sourceId), eq(schema.payments.live, live), eq(schema.payments.sample, false), inArray(schema.payments.state, SETTLED_STATES)));
  return { source: sourceId, raised_usd: round(Number(row?.usd ?? 0)), payments: row?.count ?? 0, currency: "USD", live };
}

/** USD to the cent. Sums of numerics arrive as strings and only become floats here, on the way out. */
const round = (value: number) => Math.round(value * 100) / 100;
