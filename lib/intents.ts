import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { base58 } from "@scure/base";

/**
 * Checks shared by the server and the browser. The browser repeats them before asking a wallet to
 * sign, so a compromised server still can't get a payout to an address the merchant wasn't shown.
 */

/** 1Click's quote signing key, from `@defuse-protocol/one-click-sdk-typescript` 0.1.26. */
export const ONE_CLICK_QUOTE_KEY = "ed25519:reYaWhvwu8Jzo3WUM3zhn6VrhuMEF4eADL17qtRVifc";
export const VERIFIER_CONTRACT = "intents.near";

export interface SignedQuote {
  quote: Record<string, unknown>;
  quoteRequest: Record<string, unknown>;
  signature: string;
  timestamp: string;
}

/** JSON with sorted keys and undefined left out, matching the `json-stable-stringify` output 1Click signs. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? "null" : stableStringify(item))).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

function signedRequest(request: Record<string, unknown>) {
  // Only these fields are signed. Others, such as appFees, are added by the service afterwards.
  return {
    dry: request.dry,
    swapType: request.swapType,
    slippageTolerance: request.slippageTolerance,
    originAsset: request.originAsset,
    depositType: request.depositType,
    destinationAsset: request.destinationAsset,
    amount: request.amount,
    refundTo: request.refundTo,
    refundType: request.refundType,
    recipient: request.recipient,
    recipientType: request.recipientType,
    deadline: request.deadline,
    quoteWaitingTimeMs: request.quoteWaitingTimeMs || undefined,
    referral: request.referral || undefined,
    virtualChainRecipient: request.virtualChainRecipient || undefined,
    virtualChainRefundRecipient: request.virtualChainRefundRecipient || undefined,
    customRecipientMsg: request.customRecipientMsg || undefined,
  };
}

function signedQuote(quote: Record<string, unknown>, dry: unknown) {
  const amounts = {
    amountIn: quote.amountIn,
    amountInFormatted: quote.amountInFormatted,
    amountInUsd: quote.amountInUsd,
    minAmountIn: quote.minAmountIn,
    amountOut: quote.amountOut,
    amountOutFormatted: quote.amountOutFormatted,
    amountOutUsd: quote.amountOutUsd,
    minAmountOut: quote.minAmountOut,
  };
  if (dry) return amounts;
  return {
    ...amounts,
    depositAddress: quote.depositAddress || undefined,
    depositMemo: quote.depositMemo || undefined,
    deadline: quote.deadline || undefined,
    timeWhenInactive: quote.timeWhenInactive || undefined,
    timeEstimate: quote.timeEstimate || undefined,
    refundFee: quote.refundFee || undefined,
    withdrawFee: quote.withdrawFee || undefined,
  };
}

const decodeKey = (value: string) => base58.decode(value.startsWith("ed25519:") ? value.slice("ed25519:".length) : value);

/** The message the provider signs: base58 of the SHA-256 of the stable JSON of request, quote and timestamp. */
export function quoteMessage(response: SignedQuote) {
  const data = stableStringify({ ...signedRequest(response.quoteRequest), ...signedQuote(response.quote, response.quoteRequest.dry), timestamp: response.timestamp });
  return new TextEncoder().encode(base58.encode(sha256(new TextEncoder().encode(data))));
}

export function verifyQuoteSignature(response: SignedQuote, publicKey: string = ONE_CLICK_QUOTE_KEY): boolean {
  try {
    return ed25519.verify(decodeKey(response.signature), quoteMessage(response), decodeKey(publicKey));
  } catch {
    return false;
  }
}

export interface ExpectedQuote {
  /** Who is moving funds, and where a failed route returns them. */
  owner: string;
  recipient: string;
  originAssetId: string;
  destinationAssetId: string;
  amount: string;
}

/**
 * A signature on a dry quote doesn't cover any deposit address, so it proves nothing about where funds
 * go. Only a live quote's does. And a valid signature only says the provider issued this quote, so every
 * field must still match what the merchant chose. Returns the reason it was refused, or null.
 */
function checkQuoteFields(response: SignedQuote, expected: ExpectedQuote): string | null {
  const request = response.quoteRequest;
  if (request.dry !== false) return "This isn't a live quote.";
  if (typeof response.quote.depositAddress !== "string" || !response.quote.depositAddress) return "This quote has no routing address.";
  if (request.recipient !== expected.recipient) return "This quote pays a different address than the one shown.";
  if (request.recipientType !== "DESTINATION_CHAIN") return "This quote doesn't pay out to the chain shown.";
  if (typeof request.refundTo !== "string" || request.refundTo.toLowerCase() !== expected.owner.toLowerCase()) return "This quote returns funds to someone else if it fails.";
  if (request.originAsset !== expected.originAssetId) return "This quote moves a different asset.";
  if (request.destinationAsset !== expected.destinationAssetId) return "This quote pays out in a different asset.";
  if (request.swapType !== "EXACT_INPUT" || request.amount !== expected.amount) return "This quote moves a different amount.";
  return null;
}

/** A move out of an Intents balance, signed as an intent. */
export function checkIntentQuote(response: SignedQuote, expected: ExpectedQuote): string | null {
  if (response.quoteRequest.depositType !== "INTENTS" || response.quoteRequest.refundType !== "INTENTS") return "This quote doesn't draw on your balance.";
  return checkQuoteFields(response, expected);
}

/** A refund the merchant sends from their wallet to a deposit address. */
export function checkRouteQuote(response: SignedQuote, expected: ExpectedQuote): string | null {
  if (response.quoteRequest.depositType !== "ORIGIN_CHAIN" || response.quoteRequest.refundType !== "ORIGIN_CHAIN") return "This quote isn't a deposit from your wallet.";
  return checkQuoteFields(response, expected);
}

export type ChallengeAction = "settlement" | "destination";

export function walletChallengeBody(action: ChallengeAction, orgId: string, address: string, issuedAt: string) {
  const line = action === "settlement" ? `Make ${address} the settlement wallet` : `Allow payouts to ${address}`;
  return `Gateway account action\n\n${line}\nWorkspace: ${orgId}\nIssued: ${issuedAt}`;
}

/**
 * `personal_sign` signs any text, and an Intents account accepts a signed `add_public_key` the same way,
 * so one signature on the wrong text would give away the balance for good. The browser only signs a
 * challenge that says exactly this, and names the address the merchant is looking at.
 */
export function isWalletChallenge(message: string, action: ChallengeAction, address: string): boolean {
  const match = /^Gateway account action\n\n([^\n]+)\nWorkspace: (org_[a-z0-9]+)\nIssued: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\nCode: [0-9a-f]{32}$/.exec(message);
  if (!match) return false;
  return match[1] === (action === "settlement" ? `Make ${address} the settlement wallet` : `Allow payouts to ${address}`);
}

export interface ExpectedTransfer {
  signer: string;
  /** The deposit address from a verified quote. */
  receiver: string;
  assetId: string;
  amount: string;
}

export interface TransferPayload {
  signer_id: string;
  verifying_contract: string;
  deadline: string;
  nonce: string;
  intents: { intent: string; receiver_id?: string; tokens?: Record<string, string>; [key: string]: unknown }[];
}

/**
 * The text a merchant's wallet signs grants full control over what it says, so it must say exactly
 * what we expect: one transfer, of one token, of the quoted amount, to the quoted address. Anything
 * else, such as an added key or an extra transfer, returns the reason it was refused.
 */
export function checkTransferPayload(payload: string, expected: ExpectedTransfer, now = Date.now()): string | null {
  let parsed: TransferPayload;
  try {
    parsed = JSON.parse(payload) as TransferPayload;
  } catch {
    return "The payload isn't valid JSON.";
  }
  if (parsed.verifying_contract !== VERIFIER_CONTRACT) return "The payload names the wrong contract.";
  if (typeof parsed.signer_id !== "string" || parsed.signer_id.toLowerCase() !== expected.signer.toLowerCase()) return "The payload names the wrong signer.";
  const deadline = Date.parse(parsed.deadline);
  if (!Number.isFinite(deadline) || deadline <= now) return "The payload has already expired.";
  if (!Array.isArray(parsed.intents) || parsed.intents.length !== 1) return "The payload must contain exactly one action.";
  const [intent] = parsed.intents;
  if (intent.intent !== "transfer") return `The payload asks for "${String(intent.intent)}", not a transfer.`;
  if (intent.receiver_id !== expected.receiver) return "The payload sends to an unexpected address.";
  const tokens = Object.entries(intent.tokens ?? {});
  if (tokens.length !== 1) return "The payload must move exactly one token.";
  const [[assetId, amount]] = tokens;
  if (assetId !== expected.assetId) return "The payload moves an unexpected token.";
  if (amount !== expected.amount) return "The payload moves an unexpected amount.";
  const allowed = new Set(["intent", "receiver_id", "tokens"]);
  const unknown = Object.keys(intent).filter((key) => !allowed.has(key));
  if (unknown.length) return `The payload has unexpected fields: ${unknown.join(", ")}.`;
  return null;
}

/**
 * What the verifier expects for ERC-191: `secp256k1:` plus base58 of 65 bytes, r then s then a
 * recovery byte of 0 or 1. Wallets return 27 or 28, and some chain-shifted values, so it is normalized.
 */
export function encodeErc191Signature(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{130}$/.test(clean)) throw new Error("Expected a 65-byte signature.");
  const bytes = new Uint8Array(65);
  for (let i = 0; i < 65; i += 1) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  const v = bytes[64];
  if (v === 27 || v === 28) bytes[64] = v - 27;
  else if (v > 1) throw new Error(`Unexpected recovery byte: ${v}`);
  return `secp256k1:${base58.encode(bytes)}`;
}
