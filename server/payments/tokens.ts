import "server-only";
import { ASSETS } from "@/lib/assets";
import type { AssetSymbol } from "@/lib/types";
import { log } from "../log";
import { provider } from "./provider";
import type { TokenInfo } from "./provider/types";

const TTL_MS = 60_000;
const holder = globalThis as unknown as { __gatewayTokens?: { at: number; kind: string; tokens: TokenInfo[] } };

/** Cached briefly. The API terms allow up to 24 hours; a price needs to be far fresher than that. */
export async function tokens(): Promise<TokenInfo[]> {
  const kind = provider().kind;
  const entry = holder.__gatewayTokens;
  if (entry && entry.kind === kind && Date.now() - entry.at < TTL_MS) return entry.tokens;
  try {
    const list = await provider().tokens();
    holder.__gatewayTokens = { at: Date.now(), kind, tokens: list };
    return list;
  } catch (error) {
    // A stale list is fine for display. `assertFreshPrice` refuses it for pricing a payment.
    if (entry && entry.kind === kind) {
      log("warn", "token list refresh failed; serving last list", { error });
      return entry.tokens;
    }
    throw error;
  }
}

export async function tokenFor(symbol: AssetSymbol) {
  return (await tokens()).find((token) => token.assetId === ASSETS[symbol].assetId);
}

export async function prices(): Promise<Partial<Record<AssetSymbol, number>>> {
  try {
    const list = await tokens();
    const out: Partial<Record<AssetSymbol, number>> = {};
    for (const asset of Object.values(ASSETS)) {
      const price = list.find((token) => token.assetId === asset.assetId)?.price;
      if (price) out[asset.symbol] = price;
    }
    return out;
  } catch {
    return {};
  }
}

export function resetTokenCache() {
  holder.__gatewayTokens = undefined;
}
