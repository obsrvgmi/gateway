import { ASSETS } from "./assets";
import type { AssetSymbol } from "./types";

/**
 * Money math. Everything that decides what moves is BigInt in smallest units. A float only ever
 * appears on the way to a screen.
 */

const pow10 = (exponent: number) => 10n ** BigInt(exponent);

/** A plain non-negative decimal string, such as "12.50". Throws on anything else, including exponents. */
export function decimalToBase(value: string, decimals: number): bigint {
  if (!/^\d+(\.\d+)?$/.test(value)) throw new Error(`Not a plain decimal: ${value}`);
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals))) throw new Error(`More than ${decimals} decimals: ${value}`);
  return BigInt(whole) * pow10(decimals) + BigInt(fraction.slice(0, decimals).padEnd(decimals, "0") || "0");
}

export function baseToDecimal(value: bigint | string, decimals: number): string {
  const amount = BigInt(value);
  const negative = amount < 0n;
  const absolute = negative ? -amount : amount;
  const scale = pow10(decimals);
  const fraction = (absolute % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${absolute / scale}${fraction ? `.${fraction}` : ""}`;
}

/** For display. Precision past a double's is lost here, which is why this never feeds a decision. */
export const baseToNumber = (value: bigint | string, symbol: AssetSymbol) => Number(baseToDecimal(value, ASSETS[symbol].tokenDecimals));

/** USD as a fixed-point millionth. Rejects the non-finite and negative values a bad input could produce. */
export function usdToMicros(usd: number): bigint {
  if (!Number.isFinite(usd) || usd < 0) throw new Error(`Invalid USD amount: ${usd}`);
  return BigInt(Math.round(usd * 1_000_000));
}

/**
 * How much of `symbol` is worth `usd`. Stablecoins are one dollar a token, so a $50 link pays out
 * exactly 50. Others round up, so the merchant is never a smallest unit short.
 */
export function usdToBase(usd: number, symbol: AssetSymbol, priceUsd: number): bigint {
  const { stable, tokenDecimals } = ASSETS[symbol];
  const micros = usdToMicros(usd);
  if (stable) return (micros * pow10(tokenDecimals) + 999_999n) / 1_000_000n;
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) throw new Error(`Invalid price for ${symbol}: ${priceUsd}`);
  const priceE8 = BigInt(Math.round(priceUsd * 100_000_000));
  if (priceE8 <= 0n) throw new Error(`Price too small for ${symbol}: ${priceUsd}`);
  // usd / price, scaled: (micros / 1e6) / (priceE8 / 1e8) = micros * 100 / priceE8.
  return (micros * 100n * pow10(tokenDecimals) + priceE8 - 1n) / priceE8;
}

/** Sums smallest-unit strings, ignoring nulls. */
export const sumBase = (values: (string | bigint | null | undefined)[]) => values.reduce<bigint>((total, value) => total + (value == null ? 0n : BigInt(value)), 0n);
