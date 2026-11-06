import { and, eq, inArray } from "drizzle-orm";
import { ASSETS } from "@/lib/assets";
import { verifyQuoteSignature, type SignedQuote } from "@/lib/intents";
import type { AssetSymbol } from "@/lib/types";
import { audit } from "../audit";
import { db, schema, type Db } from "../db";
import { env, liveRefused } from "../env";
import { badRequest, conflict, HttpError } from "../http/errors";
import { provider } from "./provider";
import type { QuoteRequest, QuoteResponse, TokenInfo } from "./provider/types";

/** A guard failed in a way that means something is wrong upstream, not with the customer's input. */
export class GuardError extends HttpError {
  constructor(code: string, message: string) {
    super(502, code, message);
  }
}

/**
 * NEAR's temporary origin-to-origin minimums, by origin chain. Quotes below them still return a deposit
 * address but won't fill, so we refuse first. Source: docs.near-intents.org/changelog, 2026-09-09 and
 * 2026-09-14. Remove an entry when NEAR lifts it; re-check before each release.
 */
export const ROUTE_MINIMUMS_USD: Record<string, number> = {
  bsc: 1000,
  pol: 1000,
  ton: 1000,
  op: 1000,
  avax: 1000,
  stellar: 1000,
  monad: 1000,
  xlayer: 1000,
  adi: 1000,
  tron: 100,
};

export function routeMinimumUsd(payAsset: AssetSymbol, recipientType: "INTENTS" | "DESTINATION_CHAIN") {
  if (recipientType === "INTENTS" && env().MINIMUMS_EXEMPT_INTENTS_RECIPIENT) return 0;
  return ROUTE_MINIMUMS_USD[ASSETS[payAsset].blockchain] ?? 0;
}

export function assertAboveRouteMinimum(payAsset: AssetSymbol, usd: number, recipientType: "INTENTS" | "DESTINATION_CHAIN") {
  const minimum = routeMinimumUsd(payAsset, recipientType);
  if (usd < minimum) throw badRequest(`${ASSETS[payAsset].chain} payments must be at least $${minimum}. Choose another asset.`, "route_minimum", { minimum });
}

export function assertPaymentBounds(usd: number) {
  const { MIN_PAYMENT_USD, MAX_PAYMENT_USD } = env();
  if (!Number.isFinite(usd) || usd < MIN_PAYMENT_USD) throw badRequest(`The minimum payment is $${MIN_PAYMENT_USD}.`, "amount_too_small");
  if (usd > MAX_PAYMENT_USD) throw badRequest(`The maximum payment is $${MAX_PAYMENT_USD}.`, "amount_too_large");
}

/**
 * 1Click signs quotes, and that signature is the only proof a deposit address pays the recipient we
 * asked for. Quotes touching Bitcoin don't verify, with NEAR's own SDK either, dry or live, either way
 * round (found 2026-11-06). Until NEAR explains why, those routes stay closed with real money.
 */
const UNVERIFIABLE_CHAINS = new Set(["btc"]);
export const hasUnverifiableRoute = (assets: AssetSymbol[]) => provider().kind === "oneclick" && assets.some((asset) => UNVERIFIABLE_CHAINS.has(ASSETS[asset].blockchain));

/** The off switches: `payments` stops everything, `chain:x` and `asset:Y` one route. In-flight payments keep polling. */
export async function assertRoutesOpen(assets: AssetSymbol[], database: Db = db()) {
  if (liveRefused()) throw new HttpError(503, "payments_unavailable", "Payments are unavailable right now.");
  if (hasUnverifiableRoute(assets)) throw conflict("This payment route isn't available right now. Choose another asset.", "route_unverifiable");
  const keys = ["payments", ...assets.flatMap((asset) => [`asset:${asset}`, `chain:${ASSETS[asset].blockchain}`])];
  const paused = await database
    .select({ key: schema.routeControls.key })
    .from(schema.routeControls)
    .where(and(inArray(schema.routeControls.key, keys), eq(schema.routeControls.paused, true)));
  if (paused.length) throw conflict("This payment route is paused right now. Choose another asset or try again later.", "route_paused");
}

export async function pausedRoutes(database: Db = db()) {
  const rows = await database.select({ key: schema.routeControls.key }).from(schema.routeControls).where(eq(schema.routeControls.paused, true));
  return new Set(rows.map((row) => row.key));
}

const ECHOED: (keyof QuoteRequest)[] = ["swapType", "slippageTolerance", "originAsset", "destinationAsset", "amount", "refundTo", "refundType", "recipient", "recipientType", "depositType", "dry"];
/** The service adds its own fee entry on top of ours. More than this on top of ours is not a fee we agreed to. */
const MAX_SERVICE_FEE_BPS = 30;

/** The provider must have quoted what we asked for. A mismatch here could send money somewhere else. */
export function assertQuoteEcho(sent: QuoteRequest, response: QuoteResponse) {
  for (const field of ECHOED) {
    if (response.quoteRequest[field] !== sent[field]) throw new GuardError("quote_mismatch", `The provider's quote doesn't match the request (${field}).`);
  }
  // Signed fields we never set, and can't say what they'd do.
  for (const field of ["customRecipientMsg", "virtualChainRecipient", "virtualChainRefundRecipient"]) {
    if ((response.quoteRequest as Record<string, unknown>)[field]) throw new GuardError("quote_mismatch", `The provider's quote carries an instruction we didn't ask for (${field}).`);
  }
  // Signatures don't cover fees, so these are checked by value.
  const fees = (response.quoteRequest.appFees ?? []) as { recipient: string; fee: number }[];
  const ours = sent.appFees ?? [];
  for (const fee of ours) {
    if (!fees.some((entry) => entry.recipient === fee.recipient && entry.fee === fee.fee)) throw new GuardError("quote_mismatch", "The provider's quote dropped our fee.");
  }
  const total = fees.reduce((sum, entry) => sum + entry.fee, 0);
  const allowed = ours.reduce((sum, entry) => sum + entry.fee, 0) + MAX_SERVICE_FEE_BPS;
  if (total > allowed) throw new GuardError("quote_mismatch", "The provider's quote carries unexpected fees.");
  const { amountIn, amountOut, minAmountOut } = response.quote;
  if (sent.swapType === "EXACT_OUTPUT" && (amountOut !== sent.amount || BigInt(minAmountOut) < BigInt(sent.amount))) throw new GuardError("quote_mismatch", "The quote doesn't deliver the exact amount requested.");
  if (sent.swapType === "EXACT_INPUT" && amountIn !== sent.amount) throw new GuardError("quote_mismatch", "The quote doesn't take the exact amount requested.");
}

/** A refund that costs more than this share of the payment means the route is wrong for this amount. */
const MAX_REFUND_FEE_SHARE = 0.05;

/**
 * NEAR charges `refundFee` when returning a deposit, in the origin asset. On a small payment it can
 * exceed the slippage buffer, and what happens to a remainder below the fee is undocumented.
 */
export function assertRefundFeeReasonable(quote: QuoteResponse["quote"]) {
  const fee = BigInt(quote.refundFee ?? "0");
  if (fee === 0n) return;
  if (Number(fee) / Number(BigInt(quote.amountIn)) > MAX_REFUND_FEE_SHARE) {
    throw badRequest("This amount is too small for this network's fees. Choose another asset.", "amount_below_network_fees");
  }
}

/** Refunds and direct settlement go to a chain, and NEAR's minimums cover that side as well. */
export function assertAboveDestinationMinimum(receiveAsset: AssetSymbol, usd: number) {
  const minimum = ROUTE_MINIMUMS_USD[ASSETS[receiveAsset].blockchain] ?? 0;
  if (usd < minimum) throw badRequest(`${ASSETS[receiveAsset].chain} transfers must be at least $${minimum}.`, "route_minimum", { minimum });
}

const TIMING: Record<string, { countdownMs: number; marginMs: number; requestedMs: number }> = {
  // Bitcoin confirmations take 45 to 60 minutes, so the address must outlive far more than the countdown.
  btc: { countdownMs: 60 * 60_000, marginMs: 90 * 60_000, requestedMs: 4 * 60 * 60_000 },
  default: { countdownMs: 30 * 60_000, marginMs: 15 * 60_000, requestedMs: 60 * 60_000 },
};

const timingFor = (blockchain: string) => TIMING[blockchain] ?? TIMING.default;
export const requestedDeadlineMs = (blockchain: string) => timingFor(blockchain).requestedMs;

/**
 * When we tell the customer to stop paying. Funds sent after NEAR's deadline may be lost, so this ends
 * early enough for a transaction sent at the last second to be mined. Null means there's no safe window.
 */
export function customerPayBy(blockchain: string, deadline: number, now = Date.now()): Date | null {
  const { countdownMs, marginMs } = timingFor(blockchain);
  const end = Math.min(now + countdownMs, deadline - marginMs);
  return end - now < 5 * 60_000 ? null : new Date(end);
}

export function assertQuoteSigned(response: QuoteResponse, publicKey: string) {
  if (!verifyQuoteSignature(response as unknown as SignedQuote, publicKey)) throw new GuardError("quote_signature", "The provider's quote signature didn't verify.");
}

/** A live quote we would hand out must carry somewhere to pay and a deadline we can show. */
export function assertLiveQuoteUsable(response: QuoteResponse, now = Date.now()) {
  const { depositAddress, deadline } = response.quote;
  if (!depositAddress) throw new GuardError("quote_no_address", "The provider's quote had no deposit address.");
  const parsed = deadline ? Date.parse(deadline) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= now) throw new GuardError("quote_deadline", "The provider's quote has no usable deadline.");
}

const PRICE_MAX_AGE_MS = 5 * 60_000;

/** A stale price could under-pay a merchant on a non-stable asset. Stablecoins don't use it. */
export function assertFreshPrice(symbol: AssetSymbol, token: TokenInfo | undefined, now = Date.now()) {
  if (ASSETS[symbol].stable) return;
  const updated = token?.priceUpdatedAt ? Date.parse(token.priceUpdatedAt) : Number.NaN;
  if (!token?.price || !Number.isFinite(updated) || now - updated > PRICE_MAX_AGE_MS) throw new HttpError(503, "price_stale", `We can't price ${symbol} right now. Try again shortly.`);
}

export const screeningKey = (address: string) => address.trim().toLowerCase();

/** Returns the addresses on the sanctions list. EVM addresses compare case-insensitively. */
export async function screenedHits(addresses: string[], database: Db = db()) {
  const keys = [...new Set(addresses.map(screeningKey))];
  if (!keys.length) return [];
  const rows = await database.select({ address: schema.screenedAddresses.address }).from(schema.screenedAddresses).where(inArray(schema.screenedAddresses.address, keys));
  return rows.map((row) => row.address);
}

/** Refuses with a neutral message, so the list can't be probed for why, and records the attempt. */
export async function assertNotScreened(addresses: string[], context: { orgId: string | null; action: string; ip?: string | null }, database: Db = db()) {
  const hits = await screenedHits(addresses, database);
  if (!hits.length) return;
  await audit(database, { orgId: context.orgId, actorType: "system", action: "screening.blocked", target: hits[0], detail: { during: context.action, hits }, ip: context.ip });
  throw new HttpError(403, "not_permitted", "This wallet can't be used here.");
}
