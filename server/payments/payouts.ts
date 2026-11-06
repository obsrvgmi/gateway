import "server-only";
import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { recoverMessageAddress, type Hex } from "viem";
import { ASSETS } from "@/lib/assets";
import type { AssetSymbol } from "@/lib/types";
import { audit } from "../audit";
import { db, schema, type Db, type Tx } from "../db";
import { badRequest, conflict, notFound } from "../http/errors";
import { newId } from "../ids";
import { log } from "../log";
import { emit } from "../outbox";
import { computeAvailable, heldAmounts, inFlightAmounts, readBalances } from "./availability";
import { assertNotScreened, assertRoutesOpen } from "./guards";
import { intentForClient, prepareIntent, verifySignature, type PreparedIntent } from "./intent-flow";
import { provider } from "./provider";
import { ProviderRejected, ProviderUnavailable, type StatusResponse } from "./provider/types";
import { nextIntentState, nextPollDelayMs, type IntentState } from "./state-machine";

type PayoutRow = typeof schema.payouts.$inferSelect;
type Org = typeof schema.organizations.$inferSelect;

export async function loadOrg(orgId: string, database: Db = db()) {
  const [org] = await database.select().from(schema.organizations).where(eq(schema.organizations.id, orgId)).limit(1);
  if (!org) throw notFound();
  return org;
}

export function assertHasWallet(org: Org): asserts org is Org & { walletAddress: string } {
  if (!org.walletAddress) throw conflict("Connect your settlement wallet first.", "wallet_required");
}

/** A new destination needs the settlement wallet's signature. Its own address is the one exception. */
export async function assertDestinationApproved(destination: typeof schema.destinations.$inferSelect, wallet: string) {
  if (destination.address.toLowerCase() === wallet.toLowerCase()) return;
  if (!destination.message || !destination.signature) throw conflict("Confirm this destination with your settlement wallet first.", "destination_unconfirmed");
  const recovered = await recoverMessageAddress({ message: destination.message, signature: destination.signature as Hex }).catch(() => null);
  if (recovered?.toLowerCase() !== wallet.toLowerCase() || !destination.message.includes(destination.address)) throw conflict("Confirm this destination with your current settlement wallet.", "destination_unconfirmed");
}

/**
 * Holds a row lock on the org, so two payouts can't both pass on the same funds. The balance is read
 * before the transaction: a lock must not be held across a network call, and the contract refuses an
 * overspend whatever this check concludes.
 */
async function assertAvailable(tx: Tx, org: Org, asset: AssetSymbol, amountBase: bigint, balances: Map<AssetSymbol, bigint>) {
  await tx.select({ id: schema.organizations.id }).from(schema.organizations).where(eq(schema.organizations.id, org.id)).for("update");
  const [held, inFlight] = await Promise.all([heldAmounts(org, Date.now(), tx), inFlightAmounts(org.id, tx)]);
  const free = computeAvailable(balances, held, inFlight).get(asset) ?? 0n;
  if (amountBase > free) throw conflict("That's more than is available to pay out.", "insufficient_available", { available: free.toString() });
}

export async function preparePayout(input: { orgId: string; userId: string | null; asset: AssetSymbol; amountBase: bigint; receiveAsset: AssetSymbol; destinationId: string; trigger?: "manual" | "scheduled"; ip?: string | null }) {
  const org = await loadOrg(input.orgId);
  assertHasWallet(org);
  const [destination] = await db()
    .select()
    .from(schema.destinations)
    .where(and(eq(schema.destinations.id, input.destinationId), eq(schema.destinations.orgId, org.id), isNull(schema.destinations.removedAt)))
    .limit(1);
  if (!destination) throw badRequest("Choose a saved destination.", "destination_not_found");
  await assertDestinationApproved(destination, org.walletAddress);
  await assertRoutesOpen([input.asset, input.receiveAsset]);
  await assertNotScreened([destination.address, org.walletAddress], { orgId: org.id, action: "payout", ip: input.ip });

  const id = newId("pyt_");
  const balances = await readBalances(org.walletAddress);
  await db().transaction(async (tx) => {
    await assertAvailable(tx, org, input.asset, input.amountBase, balances);
    // Lapsed attempts stop cluttering the list.
    await tx.update(schema.payouts).set({ state: "expired", updatedAt: new Date() }).where(and(eq(schema.payouts.orgId, org.id), eq(schema.payouts.state, "awaiting_signature"), lt(schema.payouts.signExpiresAt, new Date())));
  });
  const prepared = await prepareIntent({ account: org.walletAddress, asset: input.asset, amountBase: input.amountBase, receiveAsset: input.receiveAsset, recipient: destination.address });
  const row = await insertPayout({ id, org, input, destination, prepared });
  return payoutForClient(row, prepared);
}

async function insertPayout(args: { id: string; org: Org & { walletAddress: string }; input: Parameters<typeof preparePayout>[0]; destination: typeof schema.destinations.$inferSelect; prepared: PreparedIntent }) {
  const { id, org, input, destination, prepared } = args;
  const { quote } = prepared.response;
  const usd = Number(quote.amountInUsd) || 0;
  const [row] = await db()
    .insert(schema.payouts)
    .values({
      id,
      orgId: org.id,
      state: "awaiting_signature",
      asset: input.asset,
      amountBase: input.amountBase.toString(),
      receiveAsset: input.receiveAsset,
      receiveBase: quote.amountOut,
      minReceiveBase: quote.minAmountOut,
      usd: usd.toFixed(6),
      feeUsd: Math.max(0, usd - (Number(quote.amountOutUsd) || 0)).toFixed(6),
      destinationId: destination.id,
      destinationLabel: destination.label,
      destinationAddress: destination.address,
      trigger: input.trigger ?? "manual",
      signer: org.walletAddress,
      depositAddress: prepared.depositAddress,
      depositMemo: prepared.depositMemo,
      quote: prepared.response,
      quoteSignature: prepared.response.signature,
      intent: { standard: "erc191", payload: prepared.payload },
      signExpiresAt: prepared.signExpiresAt,
      requestedBy: input.userId,
      live: provider().kind === "oneclick",
    })
    .returning();
  await audit(db(), { orgId: org.id, actorType: input.userId ? "user" : "system", actorId: input.userId, action: "payout.prepared", target: id, detail: { asset: input.asset, amountBase: input.amountBase.toString(), destination: destination.address }, ip: input.ip });
  return row;
}

function payoutForClient(row: PayoutRow, prepared: PreparedIntent) {
  return {
    id: row.id,
    asset: row.asset,
    amountBase: row.amountBase,
    receiveAsset: row.receiveAsset,
    receiveBase: row.receiveBase,
    minReceiveBase: row.minReceiveBase,
    destinationLabel: row.destinationLabel,
    destinationAddress: row.destinationAddress,
    signer: row.signer,
    assetId: ASSETS[row.asset as AssetSymbol].assetId,
    ...intentForClient({ payload: prepared.payload, response: prepared.response, signExpiresAt: prepared.signExpiresAt, quoteKey: provider().quoteKey }),
  };
}

const payloadOf = (row: { intent: unknown }) => (row.intent as { payload: string }).payload;

/**
 * Sends a signed payout. The compare-and-set means only one request ever sends, and the attempt is
 * recorded before the send, so a crash can't lose track of a payout that may have gone out.
 */
export async function submitPayout(input: { orgId: string; payoutId: string; signature: string; userId: string; ip?: string | null }) {
  const [row] = await db().select().from(schema.payouts).where(and(eq(schema.payouts.id, input.payoutId), eq(schema.payouts.orgId, input.orgId))).limit(1);
  if (!row) throw notFound();
  if (row.state !== "awaiting_signature") return row;
  if (!row.signExpiresAt || row.signExpiresAt.getTime() < Date.now()) {
    await db().update(schema.payouts).set({ state: "expired", updatedAt: new Date() }).where(eq(schema.payouts.id, row.id));
    throw conflict("This payout expired before it was signed. Start it again for a fresh price.", "payout_expired");
  }
  const payload = payloadOf(row);
  const encoded = await verifySignature({
    payload,
    signature: input.signature,
    signer: row.signer,
    expected: { signer: row.signer, receiver: row.depositAddress as string, assetId: ASSETS[row.asset as AssetSymbol].assetId, amount: row.amountBase },
  });

  // Re-check at send time: another payout may have gone out since this one was prepared.
  const org = await loadOrg(input.orgId);
  assertHasWallet(org);
  if (org.walletAddress !== row.signer) throw conflict("Your settlement wallet changed. Start this payout again.", "wallet_changed");
  const balances = await readBalances(org.walletAddress);
  const claimed = await db().transaction(async (tx) => {
    await assertAvailable(tx, org, row.asset as AssetSymbol, BigInt(row.amountBase), balances);
    return tx
      .update(schema.payouts)
      .set({ state: "submitting", signature: encoded, submitAttemptedAt: new Date(), nextPollAt: new Date(Date.now() + 15_000), updatedAt: new Date() })
      .where(and(eq(schema.payouts.id, row.id), eq(schema.payouts.state, "awaiting_signature")))
      .returning();
  });
  if (!claimed.length) {
    const [current] = await db().select().from(schema.payouts).where(eq(schema.payouts.id, row.id)).limit(1);
    return current;
  }
  await audit(db(), { orgId: input.orgId, actorType: "user", actorId: input.userId, action: "payout.signed", target: row.id, ip: input.ip });

  try {
    const { intentHash } = await provider().submitIntent({ payload, signature: encoded });
    const [updated] = await db().update(schema.payouts).set({ state: "processing", intentHash, nextPollAt: new Date(Date.now() + 5_000), updatedAt: new Date() }).where(eq(schema.payouts.id, row.id)).returning();
    return updated;
  } catch (error) {
    if (error instanceof ProviderRejected) {
      const [updated] = await db().update(schema.payouts).set({ state: "failed", failureReason: error.message, nextPollAt: null, updatedAt: new Date() }).where(eq(schema.payouts.id, row.id)).returning();
      await emit(db(), row.orgId, "payout.failed", { id: row.id, reason: error.message });
      return updated;
    }
    // Unknown outcome: it may have gone through. Stay `submitting`, and let the poller find out.
    log("warn", "payout submit outcome unknown", { payoutId: row.id, error });
    const [current] = await db().select().from(schema.payouts).where(eq(schema.payouts.id, row.id)).limit(1);
    return current;
  }
}

const toIntentState = (state: string): IntentState => (state === "sent" ? "done" : (state as IntentState));

export async function applyPayoutStatus(payoutId: string, status: StatusResponse, now = new Date()) {
  return db().transaction(async (tx) => {
    const [row] = await tx.select().from(schema.payouts).where(eq(schema.payouts.id, payoutId)).for("update").limit(1);
    if (!row) return null;
    const current = toIntentState(row.state);
    const next = nextIntentState(current, status.status);
    const patch: Partial<PayoutRow> = { providerStatus: status.status, pollFailures: 0, updatedAt: now };
    if (status.swapDetails.destinationChainTxHashes.length) patch.destinationTxHashes = status.swapDetails.destinationChainTxHashes;
    if (status.swapDetails.amountOut) patch.receiveBase = status.swapDetails.amountOut;

    if (next === "done") {
      patch.state = "sent";
      patch.completedAt = now;
      patch.nextPollAt = null;
      await emit(tx, row.orgId, "payout.sent", { id: row.id, asset: row.asset, amount_base: row.amountBase, receive_asset: row.receiveAsset, receive_base: patch.receiveBase ?? row.receiveBase, destination: row.destinationAddress, tx_hashes: (patch.destinationTxHashes ?? row.destinationTxHashes).map((tx_) => tx_.hash), live: row.live });
    } else if (next === "failed") {
      patch.state = "failed";
      patch.failureReason = status.swapDetails.refundReason ?? "The route couldn't complete this payout. The funds stayed in your balance.";
      // A failure can still be corrected by a late success, so keep looking for a while.
      patch.nextPollAt = now.getTime() - row.createdAt.getTime() < 86_400_000 ? new Date(now.getTime() + 300_000) : null;
      if (current !== "failed") await emit(tx, row.orgId, "payout.failed", { id: row.id, reason: patch.failureReason });
    } else {
      if (next === "processing") patch.state = "processing";
      const state = (next ?? current) as string;
      const delay = state === "failed" ? null : nextPollDelayMs({ state: "processing", now: now.getTime(), createdAt: row.createdAt.getTime(), deadline: null, failures: 0 });
      patch.nextPollAt = delay === null ? null : new Date(now.getTime() + delay);
    }
    const [updated] = await tx.update(schema.payouts).set(patch).where(eq(schema.payouts.id, payoutId)).returning();
    return updated;
  });
}

/** Unknown outcome earlier: resending the same signed intent is safe, because its nonce is single-use. */
async function resendIfStuck(row: { id: string; state: string; intent: unknown; signature: string | null }, status: StatusResponse) {
  if (row.state !== "submitting" || status.status !== "PENDING_DEPOSIT" || !row.signature) return;
  // Past the signed deadline the verifier would refuse it anyway, so the reservation can be released.
  const deadline = Date.parse((JSON.parse(payloadOf(row)) as { deadline: string }).deadline);
  if (Date.now() > deadline) {
    await db().update(schema.payouts).set({ state: "failed", failureReason: "This payout expired before the route accepted it. The funds stayed in your balance.", nextPollAt: null, updatedAt: new Date() }).where(and(eq(schema.payouts.id, row.id), eq(schema.payouts.state, "submitting")));
    return;
  }
  try {
    const { intentHash } = await provider().submitIntent({ payload: payloadOf(row), signature: row.signature });
    await db().update(schema.payouts).set({ state: "processing", intentHash, updatedAt: new Date() }).where(and(eq(schema.payouts.id, row.id), eq(schema.payouts.state, "submitting")));
  } catch (error) {
    if (error instanceof ProviderRejected) {
      await db().update(schema.payouts).set({ state: "failed", failureReason: error.message, nextPollAt: null, updatedAt: new Date() }).where(and(eq(schema.payouts.id, row.id), eq(schema.payouts.state, "submitting")));
    }
  }
}

export async function pollDuePayouts(limit = 25) {
  const claimed = await db().execute<{ id: string; state: string; intent: unknown; signature: string | null; deposit_address: string; deposit_memo: string | null; poll_failures: number }>(sql`
    update payouts set next_poll_at = now() + interval '60 seconds'
    where id in (
      select id from payouts where next_poll_at is not null and next_poll_at <= now() and deposit_address is not null
      order by next_poll_at limit ${limit} for update skip locked
    )
    returning id, state, intent, signature, deposit_address, deposit_memo, poll_failures
  `);
  await Promise.all(
    claimed.rows.map(async (row) => {
      try {
        const status = await provider().status(row.deposit_address, row.deposit_memo);
        await resendIfStuck(row, status);
        await applyPayoutStatus(row.id, status);
      } catch (error) {
        if (!(error instanceof ProviderUnavailable || error instanceof ProviderRejected)) log("error", "payout poll failed", { payoutId: row.id, error });
        const failures = row.poll_failures + 1;
        await db().update(schema.payouts).set({ pollFailures: failures, nextPollAt: new Date(Date.now() + Math.min(30_000 * 2 ** Math.min(failures, 6), 1_800_000)) }).where(eq(schema.payouts.id, row.id));
        if (failures >= 5) log("error", "payout polling keeps failing", { payoutId: row.id, failures });
      }
    }),
  );
  return claimed.rows.length;
}

/** Anything still able to move money out of this wallet's balance. A wallet change waits for these. */
export const countOpenPayouts = async (orgId: string) => (await db().select({ id: schema.payouts.id }).from(schema.payouts).where(and(eq(schema.payouts.orgId, orgId), inArray(schema.payouts.state, ["submitting", "processing"])))).length;
