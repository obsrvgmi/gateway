import { z } from "zod";

/** 1Click's documented statuses. An unknown value fails parsing, so it can't be misread as anything. */
export const providerStatus = z.enum(["KNOWN_DEPOSIT_TX", "PENDING_DEPOSIT", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"]);
export type ProviderStatus = z.infer<typeof providerStatus>;

export interface QuoteRequest {
  dry: boolean;
  swapType: "EXACT_INPUT" | "EXACT_OUTPUT";
  slippageTolerance: number;
  originAsset: string;
  depositType: "ORIGIN_CHAIN" | "INTENTS";
  destinationAsset: string;
  amount: string;
  refundTo: string;
  refundType: "ORIGIN_CHAIN" | "INTENTS";
  recipient: string;
  recipientType: "DESTINATION_CHAIN" | "INTENTS";
  deadline: string;
  referral?: string;
  connectedWallets?: string[];
  appFees?: { recipient: string; fee: number }[];
}

const base = z.string().regex(/^\d+$/);

export const quoteDetails = z.object({
  depositAddress: z.string().min(1).optional(),
  depositMemo: z.string().min(1).optional(),
  amountIn: base,
  amountInFormatted: z.string(),
  amountInUsd: z.string(),
  minAmountIn: base,
  amountOut: base,
  amountOutFormatted: z.string(),
  amountOutUsd: z.string(),
  minAmountOut: base,
  timeEstimate: z.number(),
  deadline: z.string().optional(),
  timeWhenInactive: z.string().optional(),
  refundFee: z.string().optional(),
  withdrawFee: z.string().optional(),
}).loose();

export const quoteResponse = z.object({
  quote: quoteDetails,
  quoteRequest: z.record(z.string(), z.unknown()),
  signature: z.string().min(1),
  timestamp: z.string().min(1),
  correlationId: z.string().optional(),
});
export type QuoteResponse = z.infer<typeof quoteResponse>;

const txRef = z.object({ hash: z.string(), explorerUrl: z.string() });

export const statusResponse = z.object({
  status: providerStatus,
  updatedAt: z.string(),
  correlationId: z.string().optional(),
  quoteResponse: z.unknown().optional(),
  swapDetails: z.object({
    amountIn: base.nullish(),
    amountOut: base.nullish(),
    depositedAmount: base.nullish(),
    refundedAmount: base.nullish(),
    refundReason: z.string().nullish(),
    originChainTxHashes: z.array(txRef).default([]),
    destinationChainTxHashes: z.array(txRef).default([]),
  }).loose(),
});
export type StatusResponse = z.infer<typeof statusResponse>;

export const tokenInfo = z.object({
  assetId: z.string(),
  decimals: z.number(),
  blockchain: z.string(),
  symbol: z.string(),
  price: z.number().nullish(),
  priceUpdatedAt: z.string().nullish(),
});
export type TokenInfo = z.infer<typeof tokenInfo>;

export const generatedIntent = z.object({
  intent: z.object({ standard: z.string(), payload: z.string().min(1) }),
  correlationId: z.string().optional(),
});
export type GeneratedIntent = z.infer<typeof generatedIntent>;

export const submittedIntent = z.object({ intentHash: z.string().min(1), correlationId: z.string().optional() });

export class ProviderRejected extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Couldn't reach the provider, or it failed: the outcome is unknown, so nothing may be concluded. */
export class ProviderUnavailable extends Error {}

export interface SwapProvider {
  readonly kind: "oneclick" | "sim";
  /** The key its quotes are signed with. */
  readonly quoteKey: string;
  tokens(): Promise<TokenInfo[]>;
  quote(request: QuoteRequest): Promise<QuoteResponse>;
  status(depositAddress: string, depositMemo?: string | null): Promise<StatusResponse>;
  submitDeposit(input: { txHash: string; depositAddress: string; depositMemo?: string | null }): Promise<void>;
  generateIntent(input: { signerId: string; depositAddress: string }): Promise<GeneratedIntent>;
  submitIntent(input: { payload: string; signature: string }): Promise<{ intentHash: string }>;
  /** Smallest-unit balances in the Intents ledger for one account, in the order given. */
  balances(account: string, assetIds: string[]): Promise<string[]>;
}
