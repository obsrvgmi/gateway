import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { ASSETS } from "@/lib/assets";
import type { AssetSymbol } from "@/lib/types";
import { audit } from "../audit";
import { db, schema } from "../db";
import { conflict, HttpError, notFound } from "../http/errors";
import { newId } from "../ids";
import { log } from "../log";
import { emit } from "../outbox";
import { inFlightAmounts, readBalances } from "./availability";
import { assertLiveQuoteUsable, assertNotScreened, assertQuoteEcho, assertQuoteSigned, assertRoutesOpen, requestedDeadlineMs } from "./guards";
import { intentForClient, prepareIntent, verifySignature } from "./intent-flow";
import { baseToDecimal, sumBase } from "@/lib/money";
import { assertHasWallet, loadOrg } from "./payouts";
import { provider } from "./provider";
import { ProviderRejected, ProviderUnavailable, type QuoteRequest, type QuoteResponse, type StatusResponse } from "./provider/types";
import { paymentEventBody } from "./serialize";
import { nextIntentState, type IntentState } from "./state-machine";

type RefundRow = typeof schema.refunds.$inferSelect;
type PaymentRow = typeof schema.payments.$inferSelect;

const OPEN = ["awaiting_deposit", "submitting", "processing"];

/** What's left to refund: received, less refunds done, in the asset the merchant received. */
export const refundableBase = (payment: Pick<PaymentRow, "receivedBase" | "refundedBase">) => BigInt(payment.receivedBase ?? "0") - BigInt(payment.refundedBase);

/**
 * Starts a refund to the wallet the customer gave at checkout, in the asset and on the chain they paid
 * with. The recipient comes from the payment and never from the request, so a stolen session can't
 * point a refund at its own wallet.
 */
export async function prepareRefund(input: { orgId: string; paymentId: string; amountBase?: string | null; userId: string; ip?: string | null }) {
  const org = await loadOrg(input.orgId);
  assertHasWallet(org);
  const [payment] = await db().select().from(schema.payments).where(and(eq(schema.payments.id, input.paymentId), eq(schema.payments.orgId, org.id))).limit(1);
  if (!payment) throw notFound();
  if (payment.state !== "settled") throw conflict("Only a settled payment can be refunded.", "not_refundable");

  const remaining = refundableBase(payment);
  const amount = input.amountBase ? BigInt(input.amountBase) : remaining;
  if (amount <= 0n) throw conflict("This payment has nothing left to refund.", "not_refundable");
  if (amount > remaining) throw conflict("That's more than is left to refund on this payment.", "refund_too_large", { remaining: remaining.toString() });

  const open = await db().select({ id: schema.refunds.id }).from(schema.refunds).where(and(eq(schema.refunds.paymentId, payment.id), inArray(schema.refunds.state, OPEN))).limit(1);
  if (open.length) throw conflict("A refund for this payment is already under way.", "refund_open");

  const asset = payment.receiveAsset as AssetSymbol;
  const payAsset = payment.payAsset as AssetSymbol;
  await assertRoutesOpen([asset, payAsset]);
  await assertNotScreened([payment.payer], { orgId: org.id, action: "refund", ip: input.ip });

  const id = newId("rfd_");
  const usd = (Number(amount) / Number(BigInt(payment.receivedBase ?? "1"))) * Number(payment.usd);
  const row = { id, orgId: org.id, paymentId: payment.id, asset, amountBase: amount.toString(), payAsset, usd: usd.toFixed(6), recipient: payment.payer, requestedBy: input.userId, live: provider().kind === "oneclick" };

  // Funds in the merchant's Intents balance are signed out. Direct settlement already left for their
  // wallet, so they send from there to a deposit address that routes to the customer's asset and chain.
  if (payment.recipientType === "INTENTS") {
    const balance = (await readBalances(org.walletAddress)).get(asset) ?? 0n;
    const free = balance - ((await inFlightAmounts(org.id)).get(asset) ?? 0n);
    if (amount > free) throw conflict("Your settlement balance doesn't cover this refund.", "insufficient_available", { available: (free > 0n ? free : 0n).toString() });
    const prepared = await prepareIntent({ account: org.walletAddress, asset, amountBase: amount, receiveAsset: payAsset, recipient: payment.payer });
    await db().insert(schema.refunds).values({ ...row, kind: "intent", state: "awaiting_signature", payBase: prepared.response.quote.amountOut, signer: org.walletAddress, depositAddress: prepared.depositAddress, depositMemo: prepared.depositMemo, quote: prepared.response, quoteSignature: prepared.response.signature, intent: { standard: "erc191", payload: prepared.payload }, signExpiresAt: prepared.signExpiresAt });
    await audit(db(), { orgId: org.id, actorType: "user", actorId: input.userId, action: "refund.prepared", target: id, detail: { paymentId: payment.id, amountBase: row.amountBase } , ip: input.ip });
    return { id, kind: "intent" as const, asset, amountBase: row.amountBase, payAsset, payBase: prepared.response.quote.amountOut, minPayBase: prepared.response.quote.minAmountOut, recipient: payment.payer, signer: org.walletAddress, assetId: ASSETS[asset].assetId, ...intentForClient({ payload: prepared.payload, response: prepared.response, signExpiresAt: prepared.signExpiresAt, quoteKey: provider().quoteKey }) };
  }

  const request: QuoteRequest = {
    dry: false,
    swapType: "EXACT_INPUT",
    slippageTolerance: 100,
    originAsset: ASSETS[asset].assetId,
    depositType: "ORIGIN_CHAIN",
    destinationAsset: ASSETS[payAsset].assetId,
    amount: amount.toString(),
    refundTo: org.walletAddress,
    refundType: "ORIGIN_CHAIN",
    recipient: payment.payer,
    recipientType: "DESTINATION_CHAIN",
    deadline: new Date(Date.now() + requestedDeadlineMs(ASSETS[asset].blockchain)).toISOString(),
  };
  let response: QuoteResponse;
  try {
    response = await provider().quote(request);
  } catch (error) {
    if (error instanceof ProviderRejected) throw new HttpError(422, "route_unavailable", `The route refused this refund: ${error.message}`);
    if (error instanceof ProviderUnavailable) throw new HttpError(503, "provider_unavailable", "The payment route is briefly unavailable. Please try again.");
    throw error;
  }
  assertQuoteEcho(request, response);
  assertQuoteSigned(response, provider().quoteKey);
  assertLiveQuoteUsable(response);
  const depositAddress = response.quote.depositAddress as string;
  await db().insert(schema.refunds).values({ ...row, kind: "route", state: "awaiting_deposit", payBase: response.quote.amountOut, depositAddress, depositMemo: response.quote.depositMemo ?? null, quote: response, quoteSignature: response.signature, nextPollAt: new Date(Date.now() + 10_000) });
  await audit(db(), { orgId: org.id, actorType: "user", actorId: input.userId, action: "refund.prepared", target: id, detail: { paymentId: payment.id, amountBase: row.amountBase, route: true }, ip: input.ip });
  return {
    id,
    kind: "route" as const,
    asset,
    amountBase: row.amountBase,
    amount: baseToDecimal(amount, ASSETS[asset].tokenDecimals),
    chain: ASSETS[asset].chain,
    payAsset,
    payBase: response.quote.amountOut,
    minPayBase: response.quote.minAmountOut,
    recipient: payment.payer,
    depositAddress,
    depositMemo: response.quote.depositMemo ?? null,
    deadline: response.quote.deadline,
    quote: response,
    quoteKey: provider().quoteKey,
    assetId: ASSETS[asset].assetId,
  };
}

/** Same single-send rule as a payout: compare-and-set, the attempt recorded before the send. */
export async function submitRefund(input: { orgId: string; refundId: string; signature: string; userId: string; ip?: string | null }) {
  const [row] = await db().select().from(schema.refunds).where(and(eq(schema.refunds.id, input.refundId), eq(schema.refunds.orgId, input.orgId))).limit(1);
  if (!row) throw notFound();
  if (row.kind !== "intent" || row.state !== "awaiting_signature") return row;
  if (!row.signExpiresAt || row.signExpiresAt.getTime() < Date.now()) {
    await db().update(schema.refunds).set({ state: "expired", updatedAt: new Date() }).where(eq(schema.refunds.id, row.id));
    throw conflict("This refund expired before it was signed. Start it again for a fresh price.", "refund_expired");
  }
  const payload = (row.intent as { payload: string }).payload;
  const encoded = await verifySignature({ payload, signature: input.signature, signer: row.signer as string, expected: { signer: row.signer as string, receiver: row.depositAddress as string, assetId: ASSETS[row.asset as AssetSymbol].assetId, amount: row.amountBase } });

  const claimed = await db().transaction(async (tx) => {
    // Locking the payment makes the one-open-refund and remaining-amount checks safe against a race.
    const [payment] = await tx.select().from(schema.payments).where(eq(schema.payments.id, row.paymentId)).for("update").limit(1);
    if (!payment || payment.state !== "settled") throw conflict("A refund for this payment is already under way.", "refund_open");
    if (BigInt(row.amountBase) > refundableBase(payment)) throw conflict("That's more than is left to refund on this payment.", "refund_too_large");
    const updated = await tx.update(schema.refunds).set({ state: "submitting", signature: encoded, submitAttemptedAt: new Date(), nextPollAt: new Date(Date.now() + 15_000), updatedAt: new Date() }).where(and(eq(schema.refunds.id, row.id), eq(schema.refunds.state, "awaiting_signature"))).returning();
    if (updated.length) {
      await tx.update(schema.payments).set({ state: "refund_pending", updatedAt: new Date() }).where(eq(schema.payments.id, payment.id));
      await tx.insert(schema.paymentEvents).values({ paymentId: payment.id, fromState: "settled", toState: "refund_pending", detail: { refundId: row.id } });
    }
    return updated;
  });
  if (!claimed.length) {
    const [current] = await db().select().from(schema.refunds).where(eq(schema.refunds.id, row.id)).limit(1);
    return current;
  }
  await audit(db(), { orgId: input.orgId, actorType: "user", actorId: input.userId, action: "refund.signed", target: row.id, ip: input.ip });

  try {
    const { intentHash } = await provider().submitIntent({ payload, signature: encoded });
    const [updated] = await db().update(schema.refunds).set({ state: "processing", intentHash, nextPollAt: new Date(Date.now() + 5_000), updatedAt: new Date() }).where(eq(schema.refunds.id, row.id)).returning();
    return updated;
  } catch (error) {
    if (error instanceof ProviderRejected) return failRefund(row.id, error.message);
    log("warn", "refund submit outcome unknown", { refundId: row.id, error });
    const [current] = await db().select().from(schema.refunds).where(eq(schema.refunds.id, row.id)).limit(1);
    return current;
  }
}

async function failRefund(refundId: string, reason: string) {
  return db().transaction(async (tx) => {
    const [row] = await tx.update(schema.refunds).set({ state: "failed", failureReason: reason, nextPollAt: null, updatedAt: new Date() }).where(eq(schema.refunds.id, refundId)).returning();
    await tx.update(schema.payments).set({ state: "settled", updatedAt: new Date() }).where(and(eq(schema.payments.id, row.paymentId), eq(schema.payments.state, "refund_pending")));
    return row;
  });
}

const toIntentState = (state: string): IntentState => (state === "refunded" ? "done" : state === "awaiting_deposit" ? "processing" : (state as IntentState));

export async function applyRefundStatus(refundId: string, status: StatusResponse, now = new Date()) {
  return db().transaction(async (tx) => {
    const [row] = await tx.select().from(schema.refunds).where(eq(schema.refunds.id, refundId)).for("update").limit(1);
    if (!row || row.state === "expired") return row ?? null;
    const current = toIntentState(row.state);
    const next = nextIntentState(current, status.status);
    const patch: Partial<RefundRow> = { providerStatus: status.status, pollFailures: 0, updatedAt: now, nextPollAt: new Date(now.getTime() + 10_000) };
    const tx_ = status.swapDetails.destinationChainTxHashes[0]?.hash;
    if (tx_) patch.txHash = tx_;

    // A route refund stays out of the payment's state until the merchant's money has actually been seen.
    if (row.kind === "route" && row.state === "awaiting_deposit" && next === "processing") {
      patch.state = "processing";
      await tx.update(schema.payments).set({ state: "refund_pending", updatedAt: now }).where(and(eq(schema.payments.id, row.paymentId), eq(schema.payments.state, "settled")));
    } else if (next === "processing") {
      patch.state = "processing";
    } else if (next === "done" && current !== "done") {
      patch.state = "refunded";
      patch.completedAt = now;
      patch.nextPollAt = null;
      const [payment] = await tx.select().from(schema.payments).where(eq(schema.payments.id, row.paymentId)).for("update").limit(1);
      const refundedBase = sumBase([payment.refundedBase, row.amountBase]);
      const whole = refundedBase >= BigInt(payment.receivedBase ?? "0");
      const [updated] = await tx.update(schema.payments).set({ refundedBase: refundedBase.toString(), state: whole ? "refunded" : "settled", refundedAt: whole ? now : payment.refundedAt, updatedAt: now }).where(eq(schema.payments.id, payment.id)).returning();
      await tx.insert(schema.paymentEvents).values({ paymentId: payment.id, fromState: payment.state, toState: updated.state, providerStatus: status.status, detail: { refundId: row.id, amountBase: row.amountBase } });
      await emit(tx, row.orgId, "payment.refunded", { ...paymentEventBody(updated), refund: { id: row.id, amount_base: row.amountBase, asset: row.asset, whole } });
    } else if (next === "failed") {
      patch.state = "failed";
      patch.failureReason = status.swapDetails.refundReason ?? "The route couldn't complete this refund.";
      patch.nextPollAt = null;
      await tx.update(schema.payments).set({ state: "settled", updatedAt: now }).where(and(eq(schema.payments.id, row.paymentId), eq(schema.payments.state, "refund_pending")));
    }
    const [updated] = await tx.update(schema.refunds).set(patch).where(eq(schema.refunds.id, refundId)).returning();
    return updated;
  });
}

export async function pollDueRefunds(limit = 25) {
  const claimed = await db().execute<{ id: string; deposit_address: string; deposit_memo: string | null; poll_failures: number }>(sql`
    update refunds set next_poll_at = now() + interval '60 seconds'
    where id in (
      select id from refunds where next_poll_at is not null and next_poll_at <= now() and deposit_address is not null
      order by next_poll_at limit ${limit} for update skip locked
    )
    returning id, deposit_address, deposit_memo, poll_failures
  `);
  await Promise.all(
    claimed.rows.map(async (row) => {
      try {
        await applyRefundStatus(row.id, await provider().status(row.deposit_address, row.deposit_memo));
      } catch (error) {
        const failures = row.poll_failures + 1;
        if (!(error instanceof ProviderUnavailable || error instanceof ProviderRejected)) log("error", "refund poll failed", { refundId: row.id, error });
        await db().update(schema.refunds).set({ pollFailures: failures, nextPollAt: new Date(Date.now() + Math.min(30_000 * 2 ** Math.min(failures, 6), 1_800_000)) }).where(eq(schema.refunds.id, row.id));
      }
    }),
  );
  return claimed.rows.length;
}
