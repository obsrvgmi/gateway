import type { ChipColor } from "@/components/base/badges/chip";
import type { AssetSymbol } from "./types";

export interface Asset {
  symbol: AssetSymbol;
  name: string;
  chain: string;
  /** Mock USD price. */
  usd: number;
  decimals: number;
  tone: ChipColor;
  /** Line colour on light and dark grounds, sampled from the asset's own mark. */
  ink: { light: string; dark: string };
}

export const ASSETS: Record<AssetSymbol, Asset> = {
  ETH: { symbol: "ETH", name: "Ether", chain: "Ethereum", usd: 3280, decimals: 5, tone: "purple", ink: { light: "#5468E8", dark: "#8E9FFF" } },
  BTC: { symbol: "BTC", name: "Bitcoin", chain: "Bitcoin", usd: 96400, decimals: 6, tone: "orange", ink: { light: "#F0820F", dark: "#FF9E33" } },
  SOL: { symbol: "SOL", name: "Solana", chain: "Solana", usd: 182, decimals: 3, tone: "rose", ink: { light: "#8A3FF0", dark: "#B78CFF" } },
  NEAR: { symbol: "NEAR", name: "NEAR", chain: "NEAR Protocol", usd: 4.6, decimals: 2, tone: "gray", ink: { light: "#12B374", dark: "#2BE3A0" } },
  USDT: { symbol: "USDT", name: "Tether USD", chain: "Tron", usd: 1, decimals: 2, tone: "lime", ink: { light: "#0A9A8C", dark: "#2CCDBB" } },
  USDC: { symbol: "USDC", name: "USD Coin", chain: "Base", usd: 1, decimals: 2, tone: "blue", ink: { light: "#1259D6", dark: "#5B9DFF" } },
  BNB: { symbol: "BNB", name: "BNB", chain: "BNB Chain", usd: 620, decimals: 4, tone: "yellow", ink: { light: "#E5AC13", dark: "#F5C542" } },
  ARB: { symbol: "ARB", name: "Arbitrum", chain: "Arbitrum", usd: 0.82, decimals: 2, tone: "cyan", ink: { light: "#1E95E6", dark: "#4CB8FF" } },
};

export const PAY_ASSETS = Object.values(ASSETS);
export const RECEIVE_ASSETS = [ASSETS.USDC, ASSETS.USDT, ASSETS.NEAR, ASSETS.ETH];

/** Mock solver spread applied when the paid asset differs from the received one. */
export const ROUTE_FEE = 0.003;

export function quote(usd: number, pay: AssetSymbol, receive: AssetSymbol) {
  const fee = pay === receive ? 0 : usd * ROUTE_FEE;
  return {
    payAmount: (usd + fee) / ASSETS[pay].usd,
    receiveAmount: usd / ASSETS[receive].usd,
    feeUsd: fee,
  };
}
