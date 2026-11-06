import "server-only";
import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { ASSETS, ASSET_SYMBOLS } from "@/lib/assets";
import type { AssetAmount, AssetSymbol, Settlement } from "@/lib/types";
import { db, schema, type Db } from "../db";
import { log } from "../log";
import { baseToNumber } from "@/lib/money";
import { provider } from "./provider";
import { prices } from "./tokens";

const DAY = 86_400_000;
/** Rows that have left, or may be leaving. A `failed` still being watched counts: FAILED isn't REFUNDED, and it may yet go through. */
const IN_FLIGHT = ["submitting", "processing"];

type Org = typeof schema.organizations.$inferSelect;
type Amounts = Map<AssetSymbol, bigint>;

const add = (map: Amounts, asset: AssetSymbol, amount: bigint) => map.set(asset, (map.get(asset) ?? 0n) + amount);

/** The merchant's refund window: settled amounts still inside it, less anything already refunded. */
export async function heldAmounts(org: Org, now = Date.now(), database: Db = db()): Promise<Amounts> {
  const held: Amounts = new Map();
  if (org.holdDays <= 0) return held;
  if (!org.walletAddress) return held;
  const rows = await database
    .select({ asset: schema.payments.receiveAsset, received: schema.payments.receivedBase, refunded: schema.payments.refundedBase, settledAt: schema.payments.settledAt })
    .from(schema.payments)
    // Balances are per wallet, so only payments that landed in this wallet's account can be on hold in it.
    .where(and(eq(schema.payments.orgId, org.id), inArray(schema.payments.state, ["settled", "refund_pending"]), eq(schema.payments.recipientType, "INTENTS"), eq(schema.payments.recipient, org.walletAddress)));
  for (const row of rows) {
    if (!row.settledAt || row.settledAt.getTime() + org.holdDays * DAY <= now) continue;
    const net = BigInt(row.received ?? "0") - BigInt(row.refunded);
    if (net > 0n) add(held, row.asset as AssetSymbol, net);
  }
  return held;
}

export async function inFlightAmounts(orgId: string, database: Db = db()): Promise<Amounts> {
  const out: Amounts = new Map();
  const payouts = await database.select({ asset: schema.payouts.asset, amount: schema.payouts.amountBase }).from(schema.payouts).where(and(eq(schema.payouts.orgId, orgId), or(inArray(schema.payouts.state, IN_FLIGHT), and(eq(schema.payouts.state, "failed"), isNotNull(schema.payouts.nextPollAt)))));
  const refunds = await database.select({ asset: schema.refunds.asset, amount: schema.refunds.amountBase, kind: schema.refunds.kind }).from(schema.refunds).where(and(eq(schema.refunds.orgId, orgId), or(inArray(schema.refunds.state, IN_FLIGHT), and(eq(schema.refunds.state, "failed"), isNotNull(schema.refunds.nextPollAt)))));
  for (const row of payouts) add(out, row.asset as AssetSymbol, BigInt(row.amount));
  for (const row of refunds) if (row.kind === "intent") add(out, row.asset as AssetSymbol, BigInt(row.amount));
  return out;
}

export async function readBalances(wallet: string): Promise<Amounts> {
  const raw = await provider().balances(wallet, ASSET_SYMBOLS.map((symbol) => ASSETS[symbol].assetId));
  return new Map(ASSET_SYMBOLS.map((symbol, index) => [symbol, BigInt(raw[index])]));
}

/** What can leave now. Uses BigInt throughout. A negative figure is clamped to zero, never carried. */
export function computeAvailable(balances: Amounts, held: Amounts, inFlight: Amounts): Amounts {
  const out: Amounts = new Map();
  for (const [asset, balance] of balances) {
    const free = balance - (held.get(asset) ?? 0n) - (inFlight.get(asset) ?? 0n);
    out.set(asset, free > 0n ? free : 0n);
  }
  return out;
}

const toRows = (map: Amounts, priced: Partial<Record<AssetSymbol, number>>): AssetAmount[] =>
  [...map.entries()]
    .filter(([, amount]) => amount > 0n)
    .map(([asset, amount]) => {
      const value = baseToNumber(amount, asset);
      return { asset, base: amount.toString(), amount: value, usd: value * (priced[asset] ?? ASSETS[asset].usd) };
    })
    .sort((a, b) => b.usd - a.usd);

/** For the dashboard. A failed read reports "not fresh" rather than a zero that looks like lost money. */
export async function settlementSummary(org: Org): Promise<Settlement> {
  const summary: Settlement = { mode: org.settlementMode as Settlement["mode"], wallet: org.walletAddress, balances: [], available: [], balancesFresh: true };
  if (!org.walletAddress) return summary;
  try {
    const [balances, held, inFlight, priced] = await Promise.all([readBalances(org.walletAddress), heldAmounts(org), inFlightAmounts(org.id), prices()]);
    summary.balances = toRows(balances, priced);
    summary.available = toRows(computeAvailable(balances, held, inFlight), priced);
  } catch (error) {
    log("warn", "balance read failed", { orgId: org.id, error });
    summary.balancesFresh = false;
  }
  return summary;
}
