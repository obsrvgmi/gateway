const compact = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en-US");
// Pinned to UTC like lib/format.ts. Every dashboard timestamp is UTC and says so.
const dateTime = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });
const stamp = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "UTC" });
const secondsStamp = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "UTC" });

export const formatCompactUsd = (value: number) => compact.format(value);
export const formatCount = (value: number) => whole.format(value);
export const formatPercent = (value: number | null, digits = 1) => (value === null ? "No data" : `${(value * 100).toFixed(digits)}%`);
export const formatSeconds = (value: number | null) => (value === null ? "No data" : `${value.toFixed(1)}s`);
/** Date and time with the year, for records that can be years old. */
export const formatStamp = (iso: string) => `${dateTime.format(new Date(iso))} UTC`;
/** Date and time without the zone, for columns already headed "UTC". */
export const formatRowDate = (iso: string) => stamp.format(new Date(iso));
export const formatClock = (iso: string) => `${secondsStamp.format(new Date(iso))} UTC`;

export function relativeTime(iso: string, now: number) {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

export const plural = (count: number, noun: string) => `${whole.format(count)} ${noun}${count === 1 ? "" : "s"}`;
