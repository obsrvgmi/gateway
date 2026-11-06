"use client";

import { checkTransferPayload, ONE_CLICK_QUOTE_KEY, verifyQuoteSignature, type SignedQuote } from "./intents";
import type { PaymentsMode } from "./types";
import { connectWallet, signMessage, WalletError } from "./wallet";

export interface PreparedTransfer {
  payload: string;
  quote: unknown;
  quoteKey: string;
  signer: string;
  assetId: string;
  amountBase: string;
}

/**
 * Asks the merchant's wallet to sign, after checking in this browser that the server's request is
 * exactly what the merchant was shown. The wallet only shows a deposit address, which proves nothing
 * by itself, so the provider's signature is what ties that address to `recipient`. A compromised server
 * can't change these without failing here. Live mode ignores any key the server offers.
 */
export async function signTransfer(prepared: PreparedTransfer, expected: { recipient: string; mode: PaymentsMode }): Promise<string> {
  const response = prepared.quote as SignedQuote;
  const key = expected.mode === "live" ? ONE_CLICK_QUOTE_KEY : prepared.quoteKey;
  if (!verifyQuoteSignature(response, key)) throw new WalletError("The route's signature on this quote didn't verify, so it wasn't sent to your wallet.");
  if (response.quoteRequest.recipient !== expected.recipient) throw new WalletError("This quote pays a different address than the one shown, so it wasn't sent to your wallet.");
  const receiver = response.quote.depositAddress as string;
  const refusal = checkTransferPayload(prepared.payload, { signer: prepared.signer, receiver, assetId: prepared.assetId, amount: prepared.amountBase });
  if (refusal) throw new WalletError(`This request failed its checks and wasn't sent to your wallet. ${refusal}`);

  const account = await connectWallet();
  if (account !== prepared.signer.toLowerCase()) throw new WalletError(`Switch your wallet to ${prepared.signer}, your settlement wallet, and try again.`);
  return signMessage(account, prepared.payload);
}
