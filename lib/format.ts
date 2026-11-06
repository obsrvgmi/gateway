import { ASSETS } from "./assets";
import type { AssetSymbol } from "./types";

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
// Dates render on the server too, so the zone is pinned to keep hydration stable.
const date = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const dateTime = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });

export const formatUsd = (value: number) => usd.format(value);
export const formatUsdWhole = (value: number) => usdWhole.format(value);
export const formatDate = (iso: string) => date.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

export function formatToken(amount: number, symbol: AssetSymbol) {
  const digits = ASSETS[symbol].decimals;
  return `${amount.toLocaleString("en-US", { minimumFractionDigits: Math.min(digits, 2), maximumFractionDigits: digits })} ${symbol}`;
}

/** Hex addresses shorten. A named account like lumen-studio.near is only readable whole. */
export function shortAddress(address: string) {
  return address.startsWith("0x") && address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
