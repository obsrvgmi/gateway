import type { ChipColor } from "@/components/base/badges/chip";
import type { AssetSymbol } from "./types";

export type AddressKind = "evm" | "btc" | "sol" | "near" | "tron";

export interface Asset {
  symbol: AssetSymbol;
  name: string;
  chain: string;
  /**
   * A round illustrative USD price, for the landing page only. Anything that touches a real payment
   * uses the provider's price on the server, or `GatewayState.prices` in the dashboard.
   */
  usd: number;
  decimals: number;
  tone: ChipColor;
  /** Line colour on light and dark grounds, sampled from the asset's own mark. */
  ink: { light: string; dark: string };
  /** The provider's id for this asset, from `GET /v0/tokens`. */
  assetId: string;
  /** The provider's chain name. Minimums and pause switches key on it. */
  blockchain: string;
  /** Smallest-unit scale. All money math uses this, never `decimals`, which is display only. */
  tokenDecimals: number;
  /** Treated as one US dollar per token when pricing a payment, so a $50 link pays out exactly 50. */
  stable: boolean;
  addressKind: AddressKind;
  /** Present where a browser wallet can pay in one click. */
  evm?: { chainId: number; contract?: `0x${string}` };
}

export const ASSETS: Record<AssetSymbol, Asset> = {
  ETH: { symbol: "ETH", name: "Ether", chain: "Ethereum", usd: 3280, decimals: 5, tone: "purple", ink: { light: "#5468E8", dark: "#8E9FFF" }, assetId: "nep141:eth.omft.near", blockchain: "eth", tokenDecimals: 18, stable: false, addressKind: "evm", evm: { chainId: 1 } },
  BTC: { symbol: "BTC", name: "Bitcoin", chain: "Bitcoin", usd: 96400, decimals: 6, tone: "orange", ink: { light: "#F0820F", dark: "#FF9E33" }, assetId: "nep141:btc.omft.near", blockchain: "btc", tokenDecimals: 8, stable: false, addressKind: "btc" },
  SOL: { symbol: "SOL", name: "Solana", chain: "Solana", usd: 182, decimals: 3, tone: "rose", ink: { light: "#8A3FF0", dark: "#B78CFF" }, assetId: "nep141:sol.omft.near", blockchain: "sol", tokenDecimals: 9, stable: false, addressKind: "sol" },
  NEAR: { symbol: "NEAR", name: "NEAR", chain: "NEAR Protocol", usd: 4.6, decimals: 2, tone: "gray", ink: { light: "#12B374", dark: "#2BE3A0" }, assetId: "nep141:wrap.near", blockchain: "near", tokenDecimals: 24, stable: false, addressKind: "near" },
  USDT: { symbol: "USDT", name: "Tether USD", chain: "Tron", usd: 1, decimals: 2, tone: "lime", ink: { light: "#0A9A8C", dark: "#2CCDBB" }, assetId: "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near", blockchain: "tron", tokenDecimals: 6, stable: true, addressKind: "tron" },
  USDC: { symbol: "USDC", name: "USD Coin", chain: "Base", usd: 1, decimals: 2, tone: "blue", ink: { light: "#1259D6", dark: "#5B9DFF" }, assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", blockchain: "base", tokenDecimals: 6, stable: true, addressKind: "evm", evm: { chainId: 8453, contract: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" } },
  BNB: { symbol: "BNB", name: "BNB", chain: "BNB Chain", usd: 620, decimals: 4, tone: "yellow", ink: { light: "#E5AC13", dark: "#F5C542" }, assetId: "nep245:v2_1.omni.hot.tg:56_11111111111111111111", blockchain: "bsc", tokenDecimals: 18, stable: false, addressKind: "evm", evm: { chainId: 56 } },
  ARB: { symbol: "ARB", name: "Arbitrum", chain: "Arbitrum", usd: 0.82, decimals: 2, tone: "cyan", ink: { light: "#1E95E6", dark: "#4CB8FF" }, assetId: "nep141:arb-0x912ce59144191c1204e64559fe8253a0e49e6548.omft.near", blockchain: "arb", tokenDecimals: 18, stable: false, addressKind: "evm", evm: { chainId: 42161, contract: "0x912ce59144191c1204e64559fe8253a0e49e6548" } },
};

export const ASSET_SYMBOLS = Object.keys(ASSETS) as AssetSymbol[];
export const isAssetSymbol = (value: string): value is AssetSymbol => value in ASSETS;
export const PAY_ASSETS = Object.values(ASSETS);
export const RECEIVE_ASSETS = [ASSETS.USDC, ASSETS.USDT, ASSETS.NEAR, ASSETS.ETH];

/** The illustrative spread on the landing page's demo. Real fees come from the provider's quote. */
export const ROUTE_FEE = 0.003;

/** Landing page and builder previews only: fixed prices, no network. See `server/payments` for real quotes. */
export function quote(usd: number, pay: AssetSymbol, receive: AssetSymbol) {
  const fee = pay === receive ? 0 : usd * ROUTE_FEE;
  return {
    payAmount: (usd + fee) / ASSETS[pay].usd,
    receiveAmount: usd / ASSETS[receive].usd,
    feeUsd: fee,
  };
}
