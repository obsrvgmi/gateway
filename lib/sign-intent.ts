"use client";

import { ASSETS } from "./assets";
import { checkIntentQuote, checkRouteQuote, checkTransferPayload, isWalletChallenge, ONE_CLICK_QUOTE_KEY, verifyQuoteSignature, type ChallengeAction, type SignedQuote } from "./intents";
import type { AssetSymbol } from "./types";
import { connectWallet, signMessage, WalletError } from "./wallet";

/**
 * Only a test build trusts a key the server names. It's fixed when the bundle is built, and never taken
 * from a server response, so a compromised API can't talk a production browser into test mode.
 */
export const ALLOW_TEST_KEYS = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_TEST_BUILD === "true";

export interface PreparedTransfer {
  payload: string;
  quote: unknown;
  quoteKey: string;
}

/** What the merchant chose or was shown. None of it comes from the response being checked. */
export interface ExpectedMove {
  signer: string;
  recipient: string;
  asset: AssetSymbol;
  receiveAsset: AssetSymbol;
  amountBase: string;
}

const expectedQuote = (expected: ExpectedMove) => ({ owner: expected.signer, recipient: expected.recipient, originAssetId: ASSETS[expected.asset].assetId, destinationAssetId: ASSETS[expected.receiveAsset].assetId, amount: expected.amountBase });

function assertSigned(response: SignedQuote, serverKey: string, allowTestKey: boolean) {
  if (!verifyQuoteSignature(response, allowTestKey ? serverKey : ONE_CLICK_QUOTE_KEY)) throw new WalletError("The route's signature on this quote didn't verify, so it wasn't sent to your wallet.");
}

/**
 * Asks the merchant's wallet to sign, after checking in this browser that the request is exactly what the
 * merchant chose. The wallet only shows a routing address, so the provider's signature on a live quote is
 * what ties that address to the recipient.
 *
 * This protects against a compromised API. It proves the provider issued this quote for this recipient, not
 * that the merchant approved the recipient, and nothing here helps if the server can change this script.
 */
export async function signTransfer(prepared: PreparedTransfer, expected: ExpectedMove, allowTestKey = ALLOW_TEST_KEYS): Promise<string> {
  const response = prepared.quote as SignedQuote;
  assertSigned(response, prepared.quoteKey, allowTestKey);
  const quoteRefusal = checkIntentQuote(response, expectedQuote(expected));
  if (quoteRefusal) throw new WalletError(`${quoteRefusal} It wasn't sent to your wallet.`);
  const refusal = checkTransferPayload(prepared.payload, { signer: expected.signer, receiver: response.quote.depositAddress as string, assetId: ASSETS[expected.asset].assetId, amount: expected.amountBase });
  if (refusal) throw new WalletError(`This request failed its checks and wasn't sent to your wallet. ${refusal}`);

  const account = await connectWallet();
  if (account !== expected.signer.toLowerCase()) throw new WalletError(`Switch your wallet to ${expected.signer}, which holds these funds, and try again.`);
  return signMessage(account, prepared.payload);
}

/** The address to send a direct-mode refund to, once the quote behind it checks out. */
export function verifiedRouteAddress(prepared: { quote: unknown; quoteKey: string }, expected: ExpectedMove, allowTestKey = ALLOW_TEST_KEYS): string {
  const response = prepared.quote as SignedQuote;
  assertSigned(response, prepared.quoteKey, allowTestKey);
  const refusal = checkRouteQuote(response, expectedQuote(expected));
  if (refusal) throw new WalletError(`${refusal} Nothing was sent.`);
  return response.quote.depositAddress as string;
}

/** Signs a server-issued challenge, only if it says exactly what it should. */
export async function signChallenge(account: string, message: string, action: ChallengeAction, address: string): Promise<string> {
  if (!isWalletChallenge(message, action, address)) throw new WalletError("This request didn't look right, so it wasn't sent to your wallet.");
  return signMessage(account, message);
}
