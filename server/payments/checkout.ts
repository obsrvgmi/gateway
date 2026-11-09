import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getAddress } from "viem";
import { isValidAddress, addressError, normalizeAddress } from "@/lib/address";
import { ASSETS, type AddressKind } from "@/lib/assets";
import type { AssetSymbol } from "@/lib/types";
import { audit } from "../audit";
import { db, schema } from "../db";
import { env } from "../env";
import { badRequest, conflict, HttpError, notFound } from "../http/errors";
import { newId } from "../ids";
import { log } from "../log";
import { assertAboveDestinationMinimum, assertAboveRouteMinimum, assertFreshPrice, assertLiveQuoteUsable, assertNotScreened, assertPaymentBounds, assertQuoteEcho, assertQuoteSigned, assertRefundFeeReasonable, assertRoutesOpen, customerPayBy, GuardError, requestedDeadlineMs } from "./guards";
import { baseToDecimal, usdToBase } from "@/lib/money";
import { provider } from "./provider";
import { ProviderRejected, ProviderUnavailable, type QuoteRequest, type QuoteResponse } from "./provider/types";
import { assertOpen, settlementTarget, type Source } from "./source";
import { dashboardStatus, type PaymentState } from "./state-machine";
import { tokenFor } from "./tokens";

/** Rejected for tolerance: 1% on the deposit covers normal movement while the customer pays. */
const SLIPPAGE_BPS = 100;
/** A quote costing more than this above the merchant's price is not one a customer should see. */
const MAX_PREMIUM = 0.08;
/** Paying or delivering this far below the price means a price is wrong, and the merchant would be short. */
const MAX_SHORTFALL = 0.03;

/**
 * Valid-format addresses for a price preview only. Dry quotes can't issue an address, so no funds can
 * reach these. The provider refuses burn addresses and token contracts, so these are plain accounts.
 * EVM uses the merchant's own wallet.
 */
const PREVIEW_REFUND: Record<Exclude<AddressKind, "evm">, string> = {
  btc: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
  sol: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  near: "near",
  tron: "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7",
};

function appFees(): QuoteRequest["appFees"] {
  const { APP_FEE_BPS, APP_FEE_RECIPIENT } = env();
  return APP_FEE_BPS > 0 && APP_FEE_RECIPIENT ? [{ recipient: APP_FEE_RECIPIENT, fee: APP_FEE_BPS }] : undefined;
}

export function assertQuoteReasonable(usd: number, quote: QuoteResponse["quote"]) {
  const paying = Number(quote.amountInUsd);
  const delivering = Number(quote.amountOutUsd);
  if (!Number.isFinite(paying) || paying > usd * (1 + MAX_PREMIUM)) throw new GuardError("quote_premium", "This route is too expensive right now. Choose another asset.");
  if (paying < usd * (1 - MAX_SHORTFALL) || !Number.isFinite(delivering) || delivering < usd * (1 - MAX_SHORTFALL)) throw new GuardError("quote_shortfall", "This route's price looks wrong right now. Choose another asset.");
}

export function resolveAmount(source: Source, requested: number | null | undefined) {
  const usd = source.amount ?? requested;
  if (usd == null) throw badRequest("Enter an amount.", "amount_required");
  if (source.amount !== null && requested != null && requested !== source.amount) throw badRequest("This payment has a fixed amount.", "amount_fixed");
  assertPaymentBounds(usd);
  return usd;
}

function assertAccepted(source: Source, payAsset: AssetSymbol) {
  if (!source.accepted.includes(payAsset)) throw badRequest(`${payAsset} isn't accepted here.`, "asset_not_accepted");
}

async function amounts(source: Source, usd: number) {
  const token = await tokenFor(source.receiveAsset);
  assertFreshPrice(source.receiveAsset, token);
  const receiveBase = usdToBase(usd, source.receiveAsset, token?.price ?? 0);
  if (receiveBase <= 0n) throw badRequest("This amount is too small.", "amount_too_small");
  return receiveBase;
}

function buildRequest(input: { dry: boolean; source: Source; payAsset: AssetSymbol; receiveBase: bigint; refundTo: string; recipient: string; recipientType: QuoteRequest["recipientType"] }): QuoteRequest {
  const fees = appFees();
  return {
    dry: input.dry,
    swapType: "EXACT_OUTPUT",
    slippageTolerance: SLIPPAGE_BPS,
    originAsset: ASSETS[input.payAsset].assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: ASSETS[input.source.receiveAsset].assetId,
    amount: input.receiveBase.toString(),
    refundTo: input.refundTo,
    refundType: "ORIGIN_CHAIN",
    recipient: input.recipient,
    recipientType: input.recipientType,
    deadline: new Date(Date.now() + requestedDeadlineMs(ASSETS[input.payAsset].blockchain)).toISOString(),
    ...(fees ? { appFees: fees } : {}),
    ...(input.dry ? {} : { connectedWallets: [input.refundTo] }),
  };
}

const translate = (error: unknown): never => {
  if (error instanceof ProviderRejected) throw new HttpError(422, "route_unavailable", "We couldn't get a price for this route. Check the wallet address, or choose another asset.");
  if (error instanceof ProviderUnavailable) throw new HttpError(503, "provider_unavailable", "Payments are briefly unavailable. Please try again.");
  throw error;
};

/** What the customer would pay. Dry: no address is issued, so nothing can be sent against it. */
export async function previewQuote(source: Source, input: { payAsset: AssetSymbol; amount?: number | null }) {
  assertOpen(source);
  assertAccepted(source, input.payAsset);
  const usd = resolveAmount(source, input.amount);
  const target = settlementTarget(source.org, source.receiveAsset);
  assertAboveRouteMinimum(input.payAsset, usd, target.recipientType);
  await assertRoutesOpen([input.payAsset, source.receiveAsset]);
  const receiveBase = await amounts(source, usd);
  const kind = ASSETS[input.payAsset].addressKind;
  const request = buildRequest({ dry: true, source, payAsset: input.payAsset, receiveBase, refundTo: kind === "evm" ? getAddress(target.recipient) : PREVIEW_REFUND[kind], ...target });
  const response = await provider().quote(request).catch(translate);
  assertQuoteEcho(request, response);
  assertQuoteSigned(response, provider().quoteKey);
  assertQuoteReasonable(usd, response.quote);
  assertRefundFeeReasonable(response.quote);
  return {
    payAsset: input.payAsset,
    payAmount: response.quote.amountInFormatted,
    payUsd: Number(response.quote.amountInUsd),
    feeUsd: Math.max(0, Number(response.quote.amountInUsd) - usd),
    receiveAsset: source.receiveAsset,
    receiveAmount: baseToDecimal(receiveBase, ASSETS[source.receiveAsset].tokenDecimals),
    usd,
    timeEstimate: response.quote.timeEstimate,
    /** Taken from the deposit if it has to be returned to the customer. Disclosed at checkout. */
    refundFee: baseToDecimal(response.quote.refundFee ?? "0", ASSETS[input.payAsset].tokenDecimals),
  };
}

export const createSessionBody = z.object({
  payAsset: z.string(),
  amount: z.number().positive().nullish(),
  refundAddress: z.string().trim().min(1, "Enter your wallet address.").max(200),
  email: z.string().trim().email().max(254).nullish(),
  /** Generated by the browser for each attempt, so a double click or retry can't issue two addresses. */
  idempotencyKey: z.string().min(8).max(100),
});

export type PaymentRow = typeof schema.payments.$inferSelect;

/**
 * Issues a real deposit address. The row is written before the provider is called, so a crash can't
 * leave an address no one is tracking, and repeating the request returns the same address.
 */
export async function createSession(source: Source, input: { payAsset: AssetSymbol; amount?: number | null; refundAddress: string; email?: string | null; idempotencyKey: string; ip?: string | null }) {
  assertOpen(source);
  assertAccepted(source, input.payAsset);
  const usd = resolveAmount(source, input.amount);
  const target = settlementTarget(source.org, source.receiveAsset);
  assertAboveRouteMinimum(input.payAsset, usd, target.recipientType);
  if (target.recipientType === "DESTINATION_CHAIN") assertAboveDestinationMinimum(source.receiveAsset, usd);
  await assertRoutesOpen([input.payAsset, source.receiveAsset]);

  const kind = ASSETS[input.payAsset].addressKind;
  if (!isValidAddress(kind, input.refundAddress.trim())) throw badRequest(addressError(kind), "refund_address_invalid");
  const refundTo = kind === "evm" ? input.refundAddress.trim() : normalizeAddress(kind, input.refundAddress);
  await assertNotScreened([refundTo, target.recipient], { orgId: source.org.id, action: "checkout", ip: input.ip });

  const receiveBase = await amounts(source, usd);
  const id = newId("pay_");
  const inserted = await db()
    .insert(schema.payments)
    .values({
      id,
      orgId: source.org.id,
      sourceType: source.kind,
      sourceId: source.id,
      sourceName: source.name,
      idempotencyKey: input.idempotencyKey,
      state: "quoting",
      payAsset: input.payAsset,
      receiveAsset: source.receiveAsset,
      usd: usd.toString(),
      receiveBase: receiveBase.toString(),
      payer: refundTo,
      customerEmail: input.email ?? null,
      settlementMode: source.org.settlementMode,
      recipient: target.recipient,
      recipientType: target.recipientType,
      live: provider().kind === "oneclick",
      // A snapshot: editing the link later doesn't change what this payment was for.
      metadata: source.kind === "link" ? source.link.metadata : {},
    })
    .onConflictDoNothing({ target: [schema.payments.sourceId, schema.payments.idempotencyKey] })
    .returning({ id: schema.payments.id });

  if (!inserted.length) {
    const [existing] = await db().select().from(schema.payments).where(and(eq(schema.payments.sourceId, source.id), eq(schema.payments.idempotencyKey, input.idempotencyKey))).limit(1);
    if (!existing) throw conflict("Please try again.");
    // A key belongs to one request. Reusing it for a different one must not hand back the wrong address.
    if (existing.payAsset !== input.payAsset || existing.payer !== refundTo || Number(existing.usd) !== usd) throw conflict("This request doesn't match the earlier one.", "idempotency_mismatch");
    if (existing.state === "quoting") throw conflict("This payment is still being prepared.", "session_in_progress");
    if (existing.state === "quote_failed") throw new HttpError(422, "route_unavailable", existing.failureReason ?? "This payment couldn't be prepared. Please start again.");
    return publicSession(existing, source);
  }

  const request = buildRequest({ dry: false, source, payAsset: input.payAsset, receiveBase, refundTo, ...target });
  let response: QuoteResponse;
  try {
    response = await provider().quote(request);
    assertQuoteEcho(request, response);
    assertQuoteSigned(response, provider().quoteKey);
    assertLiveQuoteUsable(response);
    assertQuoteReasonable(usd, response.quote);
    assertRefundFeeReasonable(response.quote);
    assertAboveRouteMinimum(input.payAsset, Number(response.quote.amountInUsd), target.recipientType);
  } catch (error) {
    const message = error instanceof HttpError ? error.message : "We couldn't get a price for this route.";
    await db().update(schema.payments).set({ state: "quote_failed", failureReason: message, updatedAt: new Date() }).where(eq(schema.payments.id, id));
    await db().insert(schema.paymentEvents).values({ paymentId: id, fromState: "quoting", toState: "quote_failed", detail: { reason: message } });
    if (error instanceof GuardError) {
      await audit(db(), { orgId: source.org.id, actorType: "system", action: "quote.guard_failed", target: id, detail: { code: error.code, message: error.message } });
      log("error", "quote guard failed", { paymentId: id, code: error.code, message: error.message });
    }
    return translate(error);
  }

  const { quote } = response;
  const deadline = new Date(quote.deadline as string);
  const payBy = customerPayBy(ASSETS[input.payAsset].blockchain, deadline.getTime());
  if (!payBy) {
    await db().update(schema.payments).set({ state: "quote_failed", failureReason: "The provider's deadline leaves no safe time to pay.", updatedAt: new Date() }).where(eq(schema.payments.id, id));
    throw new HttpError(503, "provider_unavailable", "Payments are briefly unavailable. Please try again.");
  }

  const [row] = await db().transaction(async (tx) => {
    await tx.insert(schema.paymentEvents).values({ paymentId: id, fromState: "quoting", toState: "awaiting_deposit", detail: { correlationId: response.correlationId } });
    return tx
      .update(schema.payments)
      .set({
        state: "awaiting_deposit",
        payBase: quote.amountIn,
        minPayBase: quote.minAmountIn,
        feeUsd: Math.max(0, Number(quote.amountInUsd) - usd).toFixed(6),
        depositAddress: quote.depositAddress,
        depositMemo: quote.depositMemo ?? null,
        deadline,
        payBy,
        // The whole response: the docs ask partners to keep the quote and signature to settle disputes.
        quote: response,
        quoteSignature: response.signature,
        correlationId: response.correlationId ?? null,
        nextPollAt: new Date(Date.now() + 10_000),
        updatedAt: new Date(),
      })
      .where(eq(schema.payments.id, id))
      .returning();
  });
  return publicSession(row, source);
}

/** What a customer's browser may see about their own payment. The id is the capability. */
export function publicSession(row: PaymentRow, source?: Source) {
  const pay = ASSETS[row.payAsset as AssetSymbol];
  const receive = ASSETS[row.receiveAsset as AssetSymbol];
  return {
    id: row.id,
    sourceId: row.sourceId,
    state: row.state as PaymentState,
    status: dashboardStatus(row.state as PaymentState),
    live: row.live,
    payAsset: row.payAsset,
    payChain: pay.chain,
    payBase: row.payBase,
    payAmount: row.payBase ? baseToDecimal(row.payBase, pay.tokenDecimals) : null,
    minPayAmount: row.minPayBase ? baseToDecimal(row.minPayBase, pay.tokenDecimals) : null,
    receiveAsset: row.receiveAsset,
    receiveAmount: baseToDecimal(row.receiveBase, receive.tokenDecimals),
    usd: Number(row.usd),
    feeUsd: Number(row.feeUsd),
    depositAddress: row.depositAddress,
    depositMemo: row.depositMemo,
    payBy: row.payBy?.toISOString() ?? null,
    deadline: row.deadline?.toISOString() ?? null,
    refundAddress: row.payer,
    depositSubmitted: Boolean(row.clientTxHash),
    deposited: row.depositedBase ? baseToDecimal(row.depositedBase, pay.tokenDecimals) : null,
    returned: row.providerRefundedBase && row.providerRefundedBase !== "0" ? baseToDecimal(row.providerRefundedBase, pay.tokenDecimals) : null,
    returnReason: row.providerRefundReason,
    originTxs: row.originTxHashes,
    destinationTxs: row.destinationTxHashes,
    settledAt: row.settledAt?.toISOString() ?? null,
    merchant: source ? (source.kind === "widget" ? source.widget.displayName || source.org.businessName : source.org.businessName) : undefined,
  };
}

export async function loadSession(id: string) {
  const [row] = await db().select().from(schema.payments).where(eq(schema.payments.id, id)).limit(1);
  if (!row || row.state === "quoting") throw notFound("This payment isn't available.");
  return row;
}
