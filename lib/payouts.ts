import { isValidAddress } from "./address";
import { ASSETS, ROUTE_FEE, type AddressKind } from "./assets";
import type { AssetSymbol, Payment, Payout, PayoutSchedule, Settlement } from "./types";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Flat mock network cost per payout, in USD. */
const NETWORK_FEE = 0.4;

export const HOLD_OPTIONS = [0, 1, 3, 7];
const ADDRESS_KINDS: AddressKind[] = ["evm", "near", "sol", "btc", "tron"];
/** Could this hold funds on any chain we support? Whether it fits the chosen asset is checked at payout. */
export const isWalletAddress = (value: string) => ADDRESS_KINDS.some((kind) => isValidAddress(kind, value));

/**
 * The money model. Payments settle into the merchant's own settlement account; Gateway never holds
 * funds. A payout sweeps that account to a destination wallet. The hold is the merchant's own refund
 * window, not a reserve Gateway takes, so it can be changed at any time.
 *
 * For the sample data's fees only. A real payout's fees come from its quote.
 */
export function payoutFee(asset: AssetSymbol, receiveAsset: AssetSymbol, usd: number) {
  return (asset === receiveAsset ? 0 : usd * ROUTE_FEE) + NETWORK_FEE;
}

export interface AssetBalance {
  asset: AssetSymbol;
  amount: number;
  usd: number;
}

export interface Release {
  at: number;
  label: string;
  usd: number;
  count: number;
}

const byUsd = (a: AssetBalance, b: AssetBalance) => b.usd - a.usd;
const day = (time: number) => time - (time % DAY);
const label = (time: number) => {
  const date = new Date(time);
  return `${WEEKDAYS[date.getUTCDay()]}, ${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
};

/** Every figure the payouts surfaces show, from one pass over the records. */
export function ledger(payments: Payment[], payouts: Payout[], holdDays: number, now: number, settlement?: Settlement, prices: Partial<Record<AssetSymbol, number>> = {}) {
  const cleared = new Map<AssetSymbol, number>();
  const heldByAsset = new Map<AssetSymbol, number>();
  const releases = new Map<number, Release>();
  let arrivingUsd = 0;
  let arrivingCount = 0;
  let heldUsd = 0;
  let heldCount = 0;

  for (const payment of payments) {
    if (payment.status === "processing") {
      arrivingUsd += payment.usd;
      arrivingCount += 1;
    }
    // Direct settlement went straight to the wallet, so it's neither held nor available here.
    if (payment.status !== "settled" || payment.detail?.direct) continue;
    const releaseAt = new Date(payment.detail?.settledAt ?? payment.createdAt).getTime() + holdDays * DAY;
    if (releaseAt > now) {
      heldUsd += payment.usd;
      heldCount += 1;
      heldByAsset.set(payment.receiveAsset, (heldByAsset.get(payment.receiveAsset) ?? 0) + payment.receiveAmount);
      const key = day(releaseAt);
      const entry = releases.get(key) ?? { at: key, label: label(key), usd: 0, count: 0 };
      releases.set(key, { ...entry, usd: entry.usd + payment.usd, count: entry.count + 1 });
    } else {
      cleared.set(payment.receiveAsset, (cleared.get(payment.receiveAsset) ?? 0) + payment.receiveAmount);
    }
  }

  let paidOutUsd = 0;
  let sendingUsd = 0;
  let sentCount = 0;
  for (const payout of payouts) {
    // A failed or unsigned payout never left, so its funds are still available.
    if (payout.status === "failed" || payout.status === "expired" || payout.status === "awaiting_signature") continue;
    cleared.set(payout.asset, (cleared.get(payout.asset) ?? 0) - payout.amount);
    if (payout.status === "processing") sendingUsd += payout.usd;
    else {
      paidOutUsd += payout.usd;
      sentCount += 1;
    }
  }

  const toBalance = ([asset, amount]: [AssetSymbol, number]): AssetBalance => ({ asset, amount, usd: amount * (prices[asset] ?? ASSETS[asset].usd) });
  const balances = [...cleared.entries()].map(toBalance);
  // The chain is the truth once there's a wallet to read. Records alone can't see a merchant moving funds themselves.
  const available = settlement?.wallet ? settlement.available.map(({ asset, amount, usd }) => ({ asset, amount, usd })) : balances.filter((entry) => entry.usd >= 0.01).sort(byUsd);
  return {
    available,
    // A refund marked after a payout can take an asset below zero. It can't be paid out, and it doesn't reduce other assets.
    shortfall: settlement?.wallet ? [] : balances.filter((entry) => entry.usd <= -0.01).sort((a, b) => a.usd - b.usd),
    availableUsd: available.reduce((sum, entry) => sum + entry.usd, 0),
    held: [...heldByAsset.entries()].map(toBalance).sort(byUsd),
    heldUsd,
    heldCount,
    releases: [...releases.values()].sort((a, b) => a.at - b.at),
    arrivingUsd,
    arrivingCount,
    sendingUsd,
    paidOutUsd,
    sentCount,
  };
}
export type Ledger = ReturnType<typeof ledger>;

/** Null when payouts are manual. Weekly runs Monday 09:00 UTC, daily at 09:00 UTC. */
export function nextPayoutAt(schedule: PayoutSchedule, now: number) {
  if (schedule === "manual") return null;
  const today = day(now) + 9 * HOUR;
  const next = today > now ? today : today + DAY;
  if (schedule === "daily") return next;
  const weekday = new Date(next).getUTCDay();
  return next + ((8 - weekday) % 7) * DAY;
}

/** What the next scheduled run would send: everything available now, plus what clears the hold by then. */
export function nextPayoutEstimate(ledgerNow: Ledger, at: number | null) {
  if (at === null) return 0;
  return ledgerNow.availableUsd + ledgerNow.releases.filter((release) => release.at <= at).reduce((sum, release) => sum + release.usd, 0);
}

export const formatPayoutDate = label;
/** What to tell a merchant about a failed payout, including whether it's safe to try again. */
export const payoutFailureText = (payout: Pick<Payout, "failureReason" | "watching">) => `${payout.failureReason ?? "This payout didn't complete."}${payout.watching ? " It could still go through, so its funds stay reserved while we watch it for a day. Please don't send it again yet." : ""}`;

export const failedPayouts = (payouts: Payout[]) => payouts.filter((payout) => payout.status === "failed");
