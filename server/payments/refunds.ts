import "server-only";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
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
/** A route refund nobody funded can be replaced after this. Sooner, the merchant's deposit may just not have been seen yet. */
const ABANDON_AFTER_MS = 30 * 60_000;
/** An address closer than this to its deadline isn't offered again: funds sent after the deadline may be lost. */
const MIN_ADDRESS_LIFE_MS = 2 * 3_600_000;
const WATCH_FAILED_MS = 86_400_000;
const RESEND_EVERY_MS = 60_000;

const isUniqueViolation = (error: unknown) => {
  const { code, cause } = error as { code?: string; cause?: { code?: string } };
  return code === "23505" || cause?.code === "23505";
};
const quoteDeadline = (row: RefundRow) => Date.parse((row.quote as QuoteResponse | null)?.quote.deadline ?? "");
const signedDeadline = (row: { intent: unknown }) => Date.parse((JSON.parse((row.intent as { payload: string }).payload) as { deadline: string }).deadline);

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

  const [open] = await db().select().from(schema.refunds).where(and(eq(schema.refunds.paymentId, payment.id), or(inArray(schema.refunds.state, OPEN), and(eq(schema.refunds.state, "failed"), isNotNull(schema.refunds.nextPollAt))))).limit(1);
  if (open) {
    if (open.state === "failed") throw conflict("The last refund for this payment failed, and could still go through. Try again in a day, or when it's been returned.", "refund_open");
    if (open.state !== "awaiting_deposit") throw conflict("A refund for this payment is already under way.", "refund_open");
    const sameAmount = open.amountBase === amount.toString();
    // Already sent: show it, and never offer a second send.
    if (open.depositTxHash) {
      if (sameAmount) return routeRefundForClient(open);
      throw conflict("A refund for this payment is on its way.", "refund_open");
    }
    const addressGood = quoteDeadline(open) - Date.now() > MIN_ADDRESS_LIFE_MS;
    // Asked again for the same refund: the same address, so nobody is shown a second one to pay.
    if (sameAmount && addressGood) return routeRefundForClient(open);
    if (addressGood && Date.now() - open.createdAt.getTime() < ABANDON_AFTER_MS) throw conflict("A refund for this payment is waiting for your deposit. Finish that one, or try again in 30 minutes.", "refund_open");
    // Still watched: if money reaches the old address after all, it lands and is counted.
    await db().update(schema.refunds).set({ state: "abandoned", updatedAt: new Date() }).where(and(eq(schema.refunds.id, open.id), eq(schema.refunds.state, "awaiting_deposit")));
  }

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
    // A balance belongs to the key it landed under, which may be a previous wallet. That key signs.
    const account = payment.recipient;
    const balance = (await readBalances(account)).get(asset) ?? 0n;
    const free = balance - (account === org.walletAddress ? ((await inFlightAmounts(org.id)).get(asset) ?? 0n) : 0n);
    if (amount > free) throw conflict("Your settlement balance doesn't cover this refund.", "insufficient_available", { available: (free > 0n ? free : 0n).toString() });
    const prepared = await prepareIntent({ account, asset, amountBase: amount, receiveAsset: payAsset, recipient: payment.payer });
    await db().insert(schema.refunds).values({ ...row, kind: "intent", state: "awaiting_signature", payBase: prepared.response.quote.amountOut, signer: account, depositAddress: prepared.depositAddress, depositMemo: prepared.depositMemo, quote: prepared.response, quoteSignature: prepared.response.signature, intent: { standard: "erc191", payload: prepared.payload }, signExpiresAt: prepared.signExpiresAt });
    await audit(db(), { orgId: org.id, actorType: "user", actorId: input.userId, action: "refund.prepared", target: id, detail: { paymentId: payment.id, amountBase: row.amountBase } , ip: input.ip });
    return { id, kind: "intent" as const, asset, amountBase: row.amountBase, payAsset, payBase: prepared.response.quote.amountOut, minPayBase: prepared.response.quote.minAmountOut, recipient: payment.payer, signer: account, assetId: ASSETS[asset].assetId, ...intentForClient({ payload: prepared.payload, response: prepared.response, signExpiresAt: prepared.signExpiresAt, quoteKey: provider().quoteKey }) };
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
  let created: RefundRow;
  try {
    [created] = await db().insert(schema.refunds).values({ ...row, kind: "route", state: "awaiting_deposit", payBase: response.quote.amountOut, depositAddress, depositMemo: response.quote.depositMemo ?? null, quote: response, quoteSignature: response.signature, nextPollAt: new Date(Date.now() + 10_000) }).returning();
  } catch (error) {
    // Two overlapping requests: the index lets one win, and this address is never shown to anyone.
    if (isUniqueViolation(error)) throw conflict("A refund for this payment is already under way.", "refund_open");
    throw error;
  }
  await audit(db(), { orgId: org.id, actorType: "user", actorId: input.userId, action: "refund.prepared", target: id, detail: { paymentId: payment.id, amountBase: row.amountBase, route: true }, ip: input.ip });
  return routeRefundForClient(created);
}

function routeRefundForClient(row: RefundRow) {
  const asset = row.asset as AssetSymbol;
  const response = row.quote as QuoteResponse;
  return {
    id: row.id,
    kind: "route" as const,
    asset,
    amountBase: row.amountBase,
    amount: baseToDecimal(row.amountBase, ASSETS[asset].tokenDecimals),
    chain: ASSETS[asset].chain,
    /** Where a failed route returns the funds. */
    owner: response.quoteRequest.refundTo as string,
    payAsset: row.payAsset as AssetSymbol,
    payBase: response.quote.amountOut,
    minPayBase: response.quote.minAmountOut,
    recipient: row.recipient,
    depositAddress: row.depositAddress as string,
    depositMemo: row.depositMemo,
    depositTxHash: row.depositTxHash,
    deadline: response.quote.deadline,
    quote: response,
    quoteKey: provider().quoteKey,
    assetId: ASSETS[asset].assetId,
  };
}

/** Remembers the merchant's transaction, so reopening this refund can't offer a second send. */
export async function recordRefundDeposit(input: { orgId: string; refundId: string; txHash: string }) {
  const [row] = await db().update(schema.refunds).set({ depositTxHash: input.txHash, updatedAt: new Date() }).where(and(eq(schema.refunds.id, input.refundId), eq(schema.refunds.orgId, input.orgId), eq(schema.refunds.kind, "route"))).returning();
  if (!row) throw notFound();
  if (row.depositAddress) await provider().submitDeposit({ txHash: input.txHash, depositAddress: row.depositAddress, depositMemo: row.depositMemo }).catch((error) => log("warn", "refund deposit hint failed", { refundId: row.id, error }));
}

/** How far past a route refund's deadline we keep looking for a late deposit before closing it. */
const ROUTE_GRACE_MS = 7 * 86_400_000;

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
    // Only from `submitting`: the poller may have seen it finish while this response was on its way, and
    // moving it back would count it again.
    const [updated] = await db().update(schema.refunds).set({ state: "processing", intentHash, nextPollAt: new Date(Date.now() + 5_000), updatedAt: new Date() }).where(and(eq(schema.refunds.id, row.id), eq(schema.refunds.state, "submitting"))).returning();
    if (updated) return updated;
    const [current] = await db().select().from(schema.refunds).where(eq(schema.refunds.id, row.id)).limit(1);
    return current;
  } catch (error) {
    // The first send, refused outright, so nothing can have gone.
    if (error instanceof ProviderRejected) return failRefund(row.id, error.message);
    log("warn", "refund submit outcome unknown", { refundId: row.id, error });
    const [current] = await db().select().from(schema.refunds).where(eq(schema.refunds.id, row.id)).limit(1);
    return current;
  }
}

async function failRefund(refundId: string, reason: string) {
  return db().transaction(async (tx) => {
    const [row] = await tx.update(schema.refunds).set({ state: "failed", failureReason: reason, nextPollAt: null, updatedAt: new Date() }).where(and(eq(schema.refunds.id, refundId), eq(schema.refunds.state, "submitting"))).returning();
    if (!row) return (await tx.select().from(schema.refunds).where(eq(schema.refunds.id, refundId)).limit(1))[0];
    await tx.update(schema.payments).set({ state: "settled", updatedAt: new Date() }).where(and(eq(schema.payments.id, row.paymentId), eq(schema.payments.state, "refund_pending")));
    return row;
  });
}

const toIntentState = (state: string): IntentState => (state === "refunded" ? "done" : state === "awaiting_deposit" || state === "abandoned" ? "processing" : (state as IntentState));
const isUnfunded = (state: string) => state === "awaiting_deposit" || state === "abandoned";

export async function applyRefundStatus(refundId: string, status: StatusResponse, now = new Date()) {
  return db().transaction(async (tx) => {
    const [row] = await tx.select().from(schema.refunds).where(eq(schema.refunds.id, refundId)).for("update").limit(1);
    if (!row || row.state === "expired") return row ?? null;
    const current = toIntentState(row.state);
    const next = nextIntentState(current, status.status);
    const age = now.getTime() - row.createdAt.getTime();
    const patch: Partial<RefundRow> = { providerStatus: status.status, pollFailures: 0, updatedAt: now, nextPollAt: new Date(now.getTime() + (age < 3_600_000 ? 10_000 : 300_000)) };
    const tx_ = status.swapDetails.destinationChainTxHashes[0]?.hash;
    if (tx_) patch.txHash = tx_;

    // A route refund stays out of the payment's state until the merchant's money has actually been seen.
    if (isUnfunded(row.state) && status.status === "PENDING_DEPOSIT") {
      // Nothing has arrived. It can still, so this keeps watching until well past the provider's deadline.
      const deadline = quoteDeadline(row);
      if (Number.isFinite(deadline) && now.getTime() > deadline + ROUTE_GRACE_MS) {
        patch.state = "expired";
        patch.nextPollAt = null;
      }
    } else if (row.kind === "route" && isUnfunded(row.state) && next === "processing") {
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
      // FAILED isn't REFUNDED: it may yet go through. It stays watched, and blocks a new refund, for a day.
      patch.nextPollAt = status.status === "FAILED" && age < WATCH_FAILED_MS ? new Date(now.getTime() + 300_000) : null;
      await tx.update(schema.payments).set({ state: "settled", updatedAt: now }).where(and(eq(schema.payments.id, row.paymentId), eq(schema.payments.state, "refund_pending")));
    } else if (row.kind === "intent" && (row.state === "submitting" || row.state === "processing") && status.status === "PENDING_DEPOSIT" && now.getTime() > signedDeadline(row)) {
      // Past its signed deadline with nothing seen: the verifier can't execute it now, so nothing can arrive.
      patch.state = "failed";
      patch.failureReason = "This refund expired before the route accepted it.";
      patch.nextPollAt = null;
      await tx.update(schema.payments).set({ state: "settled", updatedAt: now }).where(and(eq(schema.payments.id, row.paymentId), eq(schema.payments.state, "refund_pending")));
    } else if (row.state === "failed" && !next) {
      patch.nextPollAt = age < WATCH_FAILED_MS ? new Date(now.getTime() + 300_000) : null;
    }
    const [updated] = await tx.update(schema.refunds).set(patch).where(eq(schema.refunds.id, refundId)).returning();
    return updated;
  });
}

/** As for a payout: same signed intent, safe to resend, and a refusal proves nothing. See `resendIfStuck` there. */
async function resendRefundIfStuck(row: { id: string; state: string; intent: unknown; signature: string | null; submit_attempted_at: Date | string | null }, status: StatusResponse) {
  if (row.state !== "submitting" || status.status !== "PENDING_DEPOSIT" || !row.signature) return;
  if (row.submit_attempted_at && Date.now() - new Date(row.submit_attempted_at).getTime() < RESEND_EVERY_MS) return;
  if (Date.now() > signedDeadline(row)) return;
  await db().update(schema.refunds).set({ submitAttemptedAt: new Date() }).where(eq(schema.refunds.id, row.id));
  try {
    const { intentHash } = await provider().submitIntent({ payload: (row.intent as { payload: string }).payload, signature: row.signature });
    await db().update(schema.refunds).set({ state: "processing", intentHash, updatedAt: new Date() }).where(and(eq(schema.refunds.id, row.id), eq(schema.refunds.state, "submitting")));
  } catch (error) {
    log("warn", "refund resend refused", { refundId: row.id, error });
  }
}

export async function pollDueRefunds(limit = 25) {
  const claimed = await db().execute<{ id: string; state: string; intent: unknown; signature: string | null; submit_attempted_at: Date | string | null; deposit_address: string; deposit_memo: string | null; poll_failures: number }>(sql`
    update refunds set next_poll_at = now() + interval '60 seconds'
    where id in (
      select id from refunds where next_poll_at is not null and next_poll_at <= now() and deposit_address is not null and live = ${provider().kind === "oneclick"}
      order by next_poll_at limit ${limit} for update skip locked
    )
    returning id, state, intent, signature, submit_attempted_at, deposit_address, deposit_memo, poll_failures
  `);
  await Promise.all(
    claimed.rows.map(async (row) => {
      try {
        const status = await provider().status(row.deposit_address, row.deposit_memo);
        await resendRefundIfStuck(row, status);
        await applyRefundStatus(row.id, status);
      } catch (error) {
        const failures = row.poll_failures + 1;
        if (!(error instanceof ProviderUnavailable || error instanceof ProviderRejected)) log("error", "refund poll failed", { refundId: row.id, error });
        await db().update(schema.refunds).set({ pollFailures: failures, nextPollAt: new Date(Date.now() + Math.min(30_000 * 2 ** Math.min(failures, 6), 1_800_000)) }).where(eq(schema.refunds.id, row.id));
      }
    }),
  );
  return claimed.rows.length;
}
