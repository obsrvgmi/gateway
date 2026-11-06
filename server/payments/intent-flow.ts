import "server-only";
import { recoverMessageAddress, type Hex } from "viem";
import { isValidAddress } from "@/lib/address";
import { ASSETS } from "@/lib/assets";
import { checkTransferPayload, encodeErc191Signature } from "@/lib/intents";
import type { AssetSymbol } from "@/lib/types";
import { badRequest, HttpError } from "../http/errors";
import { assertLiveQuoteUsable, assertQuoteEcho, assertQuoteSigned, GuardError, requestedDeadlineMs } from "./guards";
import { provider } from "./provider";
import { ProviderRejected, ProviderUnavailable, type QuoteRequest, type QuoteResponse } from "./provider/types";

const SLIPPAGE_BPS = 100;
/** How long a prepared payout waits for the merchant's wallet. A new quote is cheaper than a stale price. */
export const SIGN_WINDOW_MS = 10 * 60_000;

export interface PreparedIntent {
  response: QuoteResponse;
  payload: string;
  depositAddress: string;
  depositMemo: string | null;
  signExpiresAt: Date;
}

const translate = (error: unknown): never => {
  if (error instanceof ProviderRejected) throw new HttpError(422, "route_unavailable", `The route refused this: ${error.message}`);
  if (error instanceof ProviderUnavailable) throw new HttpError(503, "provider_unavailable", "The payment route is briefly unavailable. Please try again.");
  throw error;
};

/**
 * Quotes a move out of the merchant's Intents balance and gets the text for their wallet to sign. Every
 * guard runs here, and the browser runs the signature and payload checks again before asking the wallet.
 */
export async function prepareIntent(input: { account: string; asset: AssetSymbol; amountBase: bigint; receiveAsset: AssetSymbol; recipient: string }): Promise<PreparedIntent> {
  if (input.amountBase <= 0n) throw badRequest("Enter an amount above zero.");
  const destination = ASSETS[input.receiveAsset];
  if (!isValidAddress(destination.addressKind, input.recipient)) throw badRequest(`That address can't receive ${input.receiveAsset} on ${destination.chain}.`, "destination_chain_mismatch");

  const request: QuoteRequest = {
    dry: false,
    swapType: "EXACT_INPUT",
    slippageTolerance: SLIPPAGE_BPS,
    originAsset: ASSETS[input.asset].assetId,
    depositType: "INTENTS",
    destinationAsset: destination.assetId,
    amount: input.amountBase.toString(),
    // If the swap can't complete, the funds go back to the merchant's own balance.
    refundTo: input.account,
    refundType: "INTENTS",
    recipient: input.recipient,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + requestedDeadlineMs(destination.blockchain)).toISOString(),
  };
  const response = await provider().quote(request).catch(translate);
  assertQuoteEcho(request, response);
  assertQuoteSigned(response, provider().quoteKey);
  assertLiveQuoteUsable(response);
  const depositAddress = response.quote.depositAddress as string;

  const generated = await provider().generateIntent({ signerId: input.account, depositAddress }).catch(translate);
  const refusal = checkTransferPayload(generated.intent.payload, { signer: input.account, receiver: depositAddress, assetId: request.originAsset, amount: request.amount });
  if (refusal) throw new GuardError("intent_mismatch", `The provider's intent failed its checks: ${refusal}`);

  return { response, payload: generated.intent.payload, depositAddress, depositMemo: response.quote.depositMemo ?? null, signExpiresAt: new Date(Date.now() + SIGN_WINDOW_MS) };
}

/** The wallet that signed must be the merchant's. Returns the signature in the verifier's encoding. */
export async function verifySignature(input: { payload: string; signature: string; signer: string; expected: Parameters<typeof checkTransferPayload>[1] }) {
  const refusal = checkTransferPayload(input.payload, input.expected);
  if (refusal) throw badRequest(refusal, "intent_mismatch");
  let recovered: string;
  try {
    recovered = await recoverMessageAddress({ message: input.payload, signature: input.signature as Hex });
  } catch {
    throw badRequest("That signature isn't valid.", "signature_invalid");
  }
  if (recovered.toLowerCase() !== input.signer.toLowerCase()) throw badRequest("Sign with your settlement wallet.", "signature_wrong_wallet");
  return encodeErc191Signature(input.signature);
}

/** Lets the browser show the merchant the true numbers, and check them itself, before signing. */
export function intentForClient(row: { payload: string; response: QuoteResponse; signExpiresAt: Date; quoteKey: string }) {
  return { payload: row.payload, quote: row.response, signExpiresAt: row.signExpiresAt.toISOString(), quoteKey: row.quoteKey };
}
