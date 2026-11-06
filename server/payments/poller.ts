import "server-only";
import { eq, sql } from "drizzle-orm";
import { audit } from "../audit";
import { db, schema, type Tx } from "../db";
import { log } from "../log";
import { emit } from "../outbox";
import { provider } from "./provider";
import { ProviderRejected, ProviderUnavailable, type StatusResponse } from "./provider/types";
import { paymentEventBody } from "./serialize";
import { isFinalForProvider, MAX_POLL_FAILURES, nextPaymentState, nextPollDelayMs, shouldExpire, webhookEventFor, type PaymentState } from "./state-machine";

type PaymentRow = typeof schema.payments.$inferSelect;

const LEASE_SECONDS = 60;

/** Applies one status reading. Re-reads the row under a lock, so concurrent pollers can't race a transition. */
export async function applyPaymentStatus(paymentId: string, status: StatusResponse, now = new Date()) {
  return db().transaction(async (tx) => {
    const [row] = await tx.select().from(schema.payments).where(eq(schema.payments.id, paymentId)).for("update").limit(1);
    if (!row) return null;
    const current = row.state as PaymentState;
    let next = nextPaymentState(current, status.status);
    const { swapDetails } = status;
    const patch: Partial<PaymentRow> = {
      providerStatus: status.status,
      pollFailures: 0,
      originTxHashes: swapDetails.originChainTxHashes.length ? swapDetails.originChainTxHashes : row.originTxHashes,
      destinationTxHashes: swapDetails.destinationChainTxHashes.length ? swapDetails.destinationChainTxHashes : row.destinationTxHashes,
      depositedBase: swapDetails.depositedAmount ?? row.depositedBase,
      updatedAt: now,
    };

    // The amount moved after the payment finished: a second deposit, or a late refund. Docs don't say
    // what the provider does with one, so this goes to a person and leaves the money records alone.
    if (isFinalForProvider(current) && swapDetails.depositedAmount && row.depositedBase && swapDetails.depositedAmount !== row.depositedBase) {
      log("error", "deposit changed after a final outcome", { paymentId, before: row.depositedBase, after: swapDetails.depositedAmount });
      await audit(tx, { orgId: row.orgId, actorType: "system", action: "payment.deposit_changed", target: paymentId, detail: { before: row.depositedBase, after: swapDetails.depositedAmount, status: status.status } });
      await emit(tx, row.orgId, "alert.deposit_changed", { id: row.id, before: row.depositedBase, after: swapDetails.depositedAmount });
    }

    // A payment the customer abandoned. Quiet addresses stay watched, so money that arrives later still lands.
    if (!next && shouldExpire(current, now.getTime(), row.payBy?.getTime() ?? null)) next = "expired";

    if (next === "deposit_seen" || next === "processing" || next === "incomplete_deposit" || next === "settled") {
      patch.depositSeenAt = row.depositSeenAt ?? now;
    }
    if (next === "settled") {
      patch.settledAt = now;
      const seen = (patch.depositSeenAt ?? now).getTime();
      patch.settleSeconds = Math.max(1, Math.round((now.getTime() - seen) / 1000));
      if (swapDetails.amountOut) {
        patch.receivedBase = swapDetails.amountOut;
        // EXACT_OUTPUT promises the amount. Report a shortfall loudly and record what really arrived.
        if (BigInt(swapDetails.amountOut) < BigInt(row.receiveBase)) {
          log("error", "payment settled below the quoted amount", { paymentId, expected: row.receiveBase, got: swapDetails.amountOut });
          await audit(tx, { orgId: row.orgId, actorType: "system", action: "payment.short_settlement", target: paymentId, detail: { expected: row.receiveBase, got: swapDetails.amountOut } });
        }
      } else {
        patch.receivedBase = row.receiveBase;
      }
    }
    if (next === "provider_refunded") {
      patch.providerRefundedBase = swapDetails.refundedAmount ?? row.providerRefundedBase;
      patch.providerRefundReason = swapDetails.refundReason ?? null;
    }
    if (next) patch.state = next;

    const state = next ?? current;
    const delay = nextPollDelayMs({ state, now: now.getTime(), createdAt: row.createdAt.getTime(), deadline: row.deadline?.getTime() ?? null, failures: 0 });
    patch.nextPollAt = delay === null ? null : new Date(now.getTime() + delay);

    const [updated] = await tx.update(schema.payments).set(patch).where(eq(schema.payments.id, paymentId)).returning();
    if (next) await recordTransition(tx, updated, current, next, status.status);
    return updated;
  });
}

async function recordTransition(tx: Tx, row: PaymentRow, from: PaymentState, to: PaymentState, providerStatus: string) {
  await tx.insert(schema.paymentEvents).values({ paymentId: row.id, fromState: from, toState: to, providerStatus });
  const event = webhookEventFor(to);
  if (event) await emit(tx, row.orgId, event, paymentEventBody(row));
}

async function recordFailure(paymentId: string, error: unknown, now = new Date()) {
  const [row] = await db().select().from(schema.payments).where(eq(schema.payments.id, paymentId)).limit(1);
  if (!row) return;
  const failures = row.pollFailures + 1;
  const delay = nextPollDelayMs({ state: row.state as PaymentState, now: now.getTime(), createdAt: row.createdAt.getTime(), deadline: row.deadline?.getTime() ?? null, failures });
  // A provider error says nothing about the money, so only the polling schedule changes.
  await db().update(schema.payments).set({ pollFailures: failures, nextPollAt: delay === null ? null : new Date(now.getTime() + delay) }).where(eq(schema.payments.id, paymentId));
  if (failures >= 5) log("error", "status polling keeps failing", { paymentId, failures, error });
  if (failures === MAX_POLL_FAILURES) await audit(db(), { orgId: row.orgId, actorType: "system", action: "payment.polling_stopped", target: paymentId, detail: { failures } });
}

/** Claims a batch by pushing its next poll out, so another worker can't take the same rows meanwhile. */
export async function pollDuePayments(limit = 25) {
  const claimed = await db().execute<{ id: string; deposit_address: string; deposit_memo: string | null }>(sql`
    update payments set next_poll_at = now() + make_interval(secs => ${LEASE_SECONDS})
    where id in (
      select id from payments
      where next_poll_at is not null and next_poll_at <= now() and deposit_address is not null
      order by next_poll_at limit ${limit} for update skip locked
    )
    returning id, deposit_address, deposit_memo
  `);
  await Promise.all(
    claimed.rows.map(async (row) => {
      try {
        const status = await provider().status(row.deposit_address, row.deposit_memo);
        await applyPaymentStatus(row.id, status);
      } catch (error) {
        if (!(error instanceof ProviderUnavailable || error instanceof ProviderRejected)) log("error", "payment poll failed", { paymentId: row.id, error });
        await recordFailure(row.id, error);
      }
    }),
  );
  return claimed.rows.length;
}
