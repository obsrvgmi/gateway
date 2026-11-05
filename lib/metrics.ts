import { ASSETS } from "./assets";
import { DEMO_NOW } from "./seed";
import type { AssetSymbol, Payment, PaymentStatus } from "./types";

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type RangeKey = "7d" | "30d" | "90d" | "12m";
export const RANGES: { key: RangeKey; label: string; long: string }[] = [
  { key: "7d", label: "7d", long: "7 days" },
  { key: "30d", label: "30d", long: "30 days" },
  { key: "90d", label: "90d", long: "90 days" },
  { key: "12m", label: "12m", long: "12 months" },
];

const at = (payment: Payment) => new Date(payment.createdAt).getTime();
const startOfDay = (time: number) => time - (time % DAY);
const shortDate = (time: number) => {
  const date = new Date(time);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
};

/** The dashboard's "now": the demo instant, or the newest payment if one landed after it. */
export function metricsNow(payments: Payment[]) {
  return payments.reduce((latest, payment) => Math.max(latest, at(payment)), DEMO_NOW);
}

/** Customers pay this on top of the price when the route swaps assets. The merchant receives the full amount. */
export function routeFee(payment: Payment) {
  return Math.max(0, payment.payAmount * ASSETS[payment.payAsset].usd - payment.usd);
}

function percentile(sorted: number[], fraction: number) {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] : 0;
}

export function summarize(list: Payment[]) {
  const settled = list.filter((p) => p.status === "settled");
  const processing = list.filter((p) => p.status === "processing");
  const seconds = list.flatMap((p) => (p.settleSeconds !== null ? [p.settleSeconds] : [])).sort((a, b) => a - b);
  // In-flight payments have no outcome yet, so they count for neither side of the rate.
  const resolved = list.length - processing.length;
  const volume = settled.reduce((sum, p) => sum + p.usd, 0);
  return {
    total: list.length,
    count: settled.length,
    volume,
    resolved,
    inFlight: processing.reduce((sum, p) => sum + p.usd, 0),
    inFlightCount: processing.length,
    refunded: list.filter((p) => p.status === "refunded").length,
    expired: list.filter((p) => p.status === "expired").length,
    successRate: resolved ? settled.length / resolved : null,
    avgSettle: seconds.length ? seconds.reduce((sum, value) => sum + value, 0) / seconds.length : null,
    p50: percentile(seconds, 0.5),
    p95: percentile(seconds, 0.95),
    fees: settled.reduce((sum, p) => sum + routeFee(p), 0),
    avgTicket: settled.length ? volume / settled.length : 0,
    payers: new Set(settled.map((p) => p.payer)).size,
  };
}
export type Summary = ReturnType<typeof summarize>;

export interface Delta {
  label: string;
  direction: "up" | "down" | "flat" | "none";
}

export function percentDelta(current: number, previous: number): Delta {
  if (previous === 0) return current === 0 ? { label: "No change", direction: "flat" } : { label: "New", direction: "none" };
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.05) return { label: "0.0%", direction: "flat" };
  return { label: `${change > 0 ? "+" : ""}${change.toFixed(1)}%`, direction: change > 0 ? "up" : "down" };
}

/** Rates compare in percentage points: a change from 90% to 93% is +3.0 pts, not +3.3%. */
export function pointDelta(current: number | null, previous: number | null): Delta {
  if (current === null || previous === null) return { label: "No data", direction: "none" };
  const change = (current - previous) * 100;
  if (Math.abs(change) < 0.05) return { label: "0.0 pts", direction: "flat" };
  return { label: `${change > 0 ? "+" : ""}${change.toFixed(1)} pts`, direction: change > 0 ? "up" : "down" };
}

export function secondsDelta(current: number | null, previous: number | null): Delta {
  if (current === null || previous === null) return { label: "No data", direction: "none" };
  const change = current - previous;
  if (Math.abs(change) < 0.05) return { label: "0.0s", direction: "flat" };
  return { label: `${change > 0 ? "+" : ""}${change.toFixed(1)}s`, direction: change > 0 ? "up" : "down" };
}

export interface Bucket {
  key: string;
  label: string;
  /** The span the bucket covers, for tooltips and the table view. */
  span: string;
  from: number;
  to: number;
  partial: boolean;
  current: Summary;
  previous: Summary;
}

interface Edge {
  from: number;
  to: number;
  previousFrom: number;
  previousTo: number;
  label: string;
  span: string;
}

function dayEdges(now: number, days: number, step: number): Edge[] {
  const first = startOfDay(now) - (days - 1) * DAY;
  const end = startOfDay(now) + DAY;
  const edges: Edge[] = [];
  for (let from = first; from < end; from += step * DAY) {
    const to = Math.min(from + step * DAY, end);
    edges.push({
      from,
      to,
      previousFrom: from - days * DAY,
      previousTo: to - days * DAY,
      label: shortDate(from),
      span: step === 1 ? shortDate(from) : `${shortDate(from)} to ${shortDate(to - DAY)}`,
    });
  }
  return edges;
}

function monthEdges(now: number): Edge[] {
  const anchor = new Date(now);
  return Array.from({ length: 12 }, (_, index) => {
    const year = anchor.getUTCFullYear();
    const month = anchor.getUTCMonth() - 11 + index;
    const from = Date.UTC(year, month, 1);
    const to = Date.UTC(year, month + 1, 1);
    const date = new Date(from);
    return {
      from,
      to,
      previousFrom: Date.UTC(year - 1, month, 1),
      previousTo: Date.UTC(year - 1, month + 1, 1),
      label: MONTHS[date.getUTCMonth()],
      span: `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
    };
  });
}

export function rangeEdges(range: RangeKey, now: number) {
  if (range === "7d") return dayEdges(now, 7, 1);
  if (range === "30d") return dayEdges(now, 30, 1);
  if (range === "90d") return dayEdges(now, 90, 7);
  return monthEdges(now);
}

/**
 * The window, its buckets and the same span one period earlier. Buckets partition the window, so they
 * always add up to the headline. The last bucket is still running: the comparison stops at the same
 * point in the earlier period, so an unfinished day or month is never measured against a whole one.
 */
export function rangeReport(payments: Payment[], range: RangeKey) {
  const now = metricsNow(payments);
  const edges = rangeEdges(range, now);
  const elapsed = now - edges[edges.length - 1].from;
  const between = (from: number, to: number) => payments.filter((p) => at(p) >= from && at(p) < to);

  const buckets: Bucket[] = edges.map((edge, index) => {
    const last = index === edges.length - 1;
    const previousTo = last ? Math.min(edge.previousTo, edge.previousFrom + elapsed + 1) : edge.previousTo;
    return {
      key: String(edge.from),
      label: edge.label,
      span: last ? `${edge.span}, so far` : edge.span,
      from: edge.from,
      to: edge.to,
      partial: last,
      current: summarize(between(edge.from, last ? Infinity : edge.to)),
      previous: summarize(between(edge.previousFrom, previousTo)),
    };
  });

  const first = edges[0];
  const final = edges[edges.length - 1];
  const list = between(first.from, Infinity);
  const previousList = between(first.previousFrom, Math.min(final.previousTo, final.previousFrom + elapsed + 1));
  return { now, buckets, list, summary: summarize(list), previous: summarize(previousList) };
}
export type RangeReport = ReturnType<typeof rangeReport>;

export interface Share<K extends string = string> {
  key: K;
  volume: number;
  count: number;
  share: number;
}

function rank<K extends string>(list: Payment[], keyOf: (payment: Payment) => K): Share<K>[] {
  const totals = new Map<K, { volume: number; count: number }>();
  let whole = 0;
  for (const payment of list) {
    if (payment.status !== "settled") continue;
    const key = keyOf(payment);
    const entry = totals.get(key) ?? { volume: 0, count: 0 };
    entry.volume += payment.usd;
    entry.count += 1;
    totals.set(key, entry);
    whole += payment.usd;
  }
  return [...totals.entries()]
    .map(([key, entry]) => ({ key, ...entry, share: whole ? entry.volume / whole : 0 }))
    .sort((a, b) => b.volume - a.volume);
}

export const assetMix = (list: Payment[]) => rank<AssetSymbol>(list, (p) => p.payAsset);
export const receiveMix = (list: Payment[]) => rank<AssetSymbol>(list, (p) => p.receiveAsset);
export const chainMix = (list: Payment[]) => rank(list, (p) => ASSETS[p.payAsset].chain);
export const channelMix = (list: Payment[]) => rank<"link" | "widget">(list, (p) => p.sourceType);

export function routeFlows(list: Payment[]) {
  return rank(list, (p) => `${p.payAsset}>${p.receiveAsset}`).map((flow) => {
    const [pay, receive] = flow.key.split(">") as [AssetSymbol, AssetSymbol];
    return { ...flow, pay, receive };
  });
}

export function leaderboard(list: Payment[], previous: Payment[]) {
  const before = new Map(rank(previous, (p) => p.sourceId).map((entry) => [entry.key, entry.volume]));
  const names = new Map(list.map((p) => [p.sourceId, { name: p.sourceName, type: p.sourceType }]));
  return rank(list, (p) => p.sourceId).map((entry) => ({
    ...entry,
    name: names.get(entry.key)?.name ?? entry.key,
    type: names.get(entry.key)?.type ?? ("link" as const),
    delta: percentDelta(entry.volume, before.get(entry.key) ?? 0),
  }));
}

export const SETTLE_BINS = [
  { label: "Under 20s", short: "<20", min: 0, max: 20 },
  { label: "20 to 25s", short: "20s", min: 20, max: 25 },
  { label: "25 to 30s", short: "25s", min: 25, max: 30 },
  { label: "30 to 35s", short: "30s", min: 30, max: 35 },
  { label: "35 to 40s", short: "35s", min: 35, max: 40 },
  { label: "40s or more", short: "40+", min: 40, max: Infinity },
];

export function settleHistogram(list: Payment[]) {
  const seconds = list.flatMap((p) => (p.settleSeconds !== null ? [p.settleSeconds] : []));
  return SETTLE_BINS.map((bin) => ({ label: bin.label, short: bin.short, count: seconds.filter((value) => value >= bin.min && value < bin.max).length }));
}

export function settleByAsset(list: Payment[]) {
  const groups = new Map<AssetSymbol, number[]>();
  for (const p of list) {
    if (p.settleSeconds === null) continue;
    groups.set(p.payAsset, [...(groups.get(p.payAsset) ?? []), p.settleSeconds]);
  }
  return [...groups.entries()]
    .map(([asset, values]) => ({ asset, average: values.reduce((sum, value) => sum + value, 0) / values.length, count: values.length }))
    .sort((a, b) => b.average - a.average);
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Settled payments by weekday and three-hour block, UTC. */
export function activityGrid(list: Payment[]) {
  const cells = WEEKDAYS.map(() => Array.from({ length: 8 }, () => 0));
  for (const p of list) {
    if (p.status !== "settled") continue;
    const date = new Date(at(p));
    cells[(date.getUTCDay() + 6) % 7][Math.floor(date.getUTCHours() / 3)] += 1;
  }
  let peak = { day: 0, block: 0, count: 0 };
  cells.forEach((row, day) => row.forEach((count, block) => {
    if (count > peak.count) peak = { day, block, count };
  }));
  return { cells, weekdays: WEEKDAYS, peak, max: peak.count };
}

/** Lifetime totals reaching the wallet, per received asset. */
export function walletTotals(payments: Payment[]) {
  const settled = payments.filter((p) => p.status === "settled");
  const totals = new Map<AssetSymbol, { amount: number; usd: number }>();
  for (const p of settled) {
    const entry = totals.get(p.receiveAsset) ?? { amount: 0, usd: 0 };
    entry.amount += p.receiveAmount;
    entry.usd += p.usd;
    totals.set(p.receiveAsset, entry);
  }
  const assets = [...totals.entries()].map(([asset, entry]) => ({ asset, ...entry })).sort((a, b) => b.usd - a.usd);
  return { assets, usd: assets.reduce((sum, entry) => sum + entry.usd, 0) };
}

export function statusCounts(list: Payment[]) {
  const counts: Record<PaymentStatus, number> = { settled: 0, processing: 0, refunded: 0, expired: 0 };
  for (const p of list) counts[p.status] += 1;
  return counts;
}

export function sourceTotals(payments: Payment[], sourceId: string) {
  const settled = payments.filter((p) => p.sourceId === sourceId && p.status === "settled");
  return { count: settled.length, volume: settled.reduce((sum, p) => sum + p.usd, 0) };
}

/** Settled volume per day for a source, oldest first, for thumbnails. */
export function sourceTrend(payments: Payment[], sourceId: string, days = 30) {
  const now = metricsNow(payments);
  const first = startOfDay(now) - (days - 1) * DAY;
  const points = Array.from({ length: days }, () => 0);
  for (const p of payments) {
    if (p.sourceId !== sourceId || p.status !== "settled") continue;
    const index = Math.floor((at(p) - first) / DAY);
    if (index >= 0 && index < days) points[index] += p.usd;
  }
  return points;
}

export interface TimelineStep {
  label: string;
  detail: string;
  at: string | null;
  state: "done" | "current" | "pending" | "failed";
}

/** The mock settlement story for a payment, derived from its status and settle time. */
export function paymentTimeline(payment: Payment): TimelineStep[] {
  const start = at(payment);
  const stamp = (seconds: number) => new Date(start + seconds * 1000).toISOString();
  const seconds = payment.settleSeconds ?? 0;
  const chain = ASSETS[payment.payAsset].chain;
  const opened: TimelineStep = { label: "Checkout opened", detail: `Quote locked for ${payment.payAsset}`, at: payment.createdAt, state: "done" };

  if (payment.status === "expired") {
    return [opened, { label: "Quote expired", detail: "The customer did not send funds in time", at: stamp(900), state: "failed" }];
  }
  if (payment.status === "processing") {
    return [
      opened,
      { label: "Funds detected", detail: `Seen on ${chain}`, at: stamp(8), state: "done" },
      { label: "Routing", detail: `Swapping ${payment.payAsset} to ${payment.receiveAsset}`, at: null, state: "current" },
      { label: "Settled to wallet", detail: "Waiting on the route", at: null, state: "pending" },
    ];
  }
  const steps: TimelineStep[] = [
    opened,
    { label: "Funds detected", detail: `Seen on ${chain}`, at: stamp(Math.round(seconds * 0.3)), state: "done" },
    { label: "Routed", detail: payment.payAsset === payment.receiveAsset ? "No swap needed" : `Swapped ${payment.payAsset} to ${payment.receiveAsset}`, at: stamp(Math.round(seconds * 0.75)), state: "done" },
    { label: "Settled to wallet", detail: `${seconds} seconds end to end`, at: stamp(seconds), state: "done" },
  ];
  if (payment.status === "refunded") {
    steps.push({ label: "Refunded", detail: "Returned to the payer", at: payment.refundedAt ?? null, state: "failed" });
  }
  return steps;
}
