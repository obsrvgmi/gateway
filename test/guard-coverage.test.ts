import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ASSETS } from "@/lib/assets";
import { db, schema } from "@/server/db";
import { resetEnv } from "@/server/env";
import { newId } from "@/server/ids";
import { createSession, loadSession, publicSession } from "@/server/payments/checkout";
import { assertAboveDestinationMinimum } from "@/server/payments/guards";
import { applyPaymentStatus } from "@/server/payments/poller";
import { applyPayoutStatus, pollDuePayouts, preparePayout, submitPayout } from "@/server/payments/payouts";
import { provider, setProviderForTests } from "@/server/payments/provider";
import { signSimQuote, SimProvider } from "@/server/payments/provider/sim";
import { ProviderRejected, ProviderUnavailable, type QuoteRequest, type QuoteResponse, type SwapProvider } from "@/server/payments/provider/types";
import { applyRefundStatus, pollDueRefunds, prepareRefund, submitRefund } from "@/server/payments/refunds";
import { toPayout } from "@/server/payments/serialize";
import { RELEASE_GRACE_MS, WATCH_FAILED_MS } from "@/server/payments/state-machine";
import { loadSource } from "@/server/payments/source";
import { addDestination, issueChallenge } from "@/server/payments/wallet";
import { createLink, createOrg, freshDatabase, WALLET_KEY } from "./support/db";

const merchant = privateKeyToAccount(WALLET_KEY);
const wallet = merchant.address.toLowerCase();
const stranger = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ea870594951c6ec0c7c1ac5");
const CUSTOMER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const key = () => randomBytes(8).toString("hex");

let close: () => Promise<void>;
beforeAll(async () => {
  ({ close } = await freshDatabase());
});
afterAll(async () => close());
afterEach(() => {
  setProviderForTests(null);
  delete process.env.APP_FEE_BPS;
  delete process.env.APP_FEE_RECIPIENT;
  resetEnv();
});

function hostile(overrides: Partial<SwapProvider>): SwapProvider {
  const sim = provider();
  return Object.assign(Object.create(Object.getPrototypeOf(sim)), sim, overrides, { kind: "sim", quoteKey: sim.quoteKey }) as SwapProvider;
}

/** A quote changed and then re-signed, so the signature check passes and only the guard under test can catch it. */
const resigned = (change: (response: QuoteResponse) => void) => {
  const sim = new SimProvider();
  return hostile({
    quote: async (request: QuoteRequest) => {
      const response = await sim.quote(request);
      change(response);
      return signSimQuote(response);
    },
  });
};

/** Changed and not re-signed. */
const tampered = (change: (response: QuoteResponse) => void) => {
  const sim = new SimProvider();
  return hostile({
    quote: async (request: QuoteRequest) => {
      const response = await sim.quote(request);
      change(response);
      return response;
    },
  });
};

async function checkoutAttempt(provider_: SwapProvider) {
  const { orgId } = await createOrg({ walletAddress: wallet });
  const source = await loadSource(await createLink(orgId));
  setProviderForTests(provider_);
  return createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: key() });
}

describe("checkout, with a correctly signed quote that's still wrong", () => {
  it("refuses one with no deposit address", async () => {
    await expect(checkoutAttempt(resigned((r) => { delete r.quote.depositAddress; }))).rejects.toMatchObject({ code: "quote_no_address" });
  });

  it("refuses one with no deadline", async () => {
    await expect(checkoutAttempt(resigned((r) => { delete r.quote.deadline; }))).rejects.toMatchObject({ code: "quote_deadline" });
  });

  it("refuses one whose deadline has passed", async () => {
    await expect(checkoutAttempt(resigned((r) => { r.quote.deadline = "2020-01-01T00:00:00.000Z"; }))).rejects.toMatchObject({ code: "quote_deadline" });
  });

  it("refuses one costing the customer far more than the price", async () => {
    await expect(checkoutAttempt(resigned((r) => { r.quote.amountInUsd = "500"; }))).rejects.toMatchObject({ code: "quote_premium" });
  });

  it("refuses one that dropped our fee", async () => {
    Object.assign(process.env, { APP_FEE_BPS: "30", APP_FEE_RECIPIENT: "gateway.near" });
    resetEnv();
    await expect(checkoutAttempt(tampered((r) => { r.quoteRequest.appFees = [{ recipient: "someone.near", fee: 30 }]; }))).rejects.toMatchObject({ code: "quote_mismatch" });
  });

  it("accepts one carrying our fee", async () => {
    Object.assign(process.env, { APP_FEE_BPS: "30", APP_FEE_RECIPIENT: "gateway.near" });
    resetEnv();
    await expect(checkoutAttempt(new SimProvider())).resolves.toMatchObject({ state: "awaiting_deposit" });
  });
});

describe("the receive-side minimum", () => {
  it("applies to a chain under a minimum, and not to others", () => {
    expect(() => assertAboveDestinationMinimum("BNB", 999)).toThrow(/at least \$1000/);
    expect(() => assertAboveDestinationMinimum("BNB", 1000)).not.toThrow();
    expect(() => assertAboveDestinationMinimum("USDC", 1)).not.toThrow();
  });
});

async function fund(amount: bigint) {
  await db().insert(schema.simBalances).values({ account: wallet, assetId: ASSETS.USDC.assetId, amount: amount.toString() }).onConflictDoUpdate({ target: [schema.simBalances.account, schema.simBalances.assetId], set: { amount: amount.toString() } });
}

async function payoutSetup(destinationOverrides: Partial<typeof schema.destinations.$inferInsert> = {}) {
  await fund(100_000_000n);
  const { orgId, userId } = await createOrg({ walletAddress: wallet });
  const destinationId = newId("dst_");
  await db().insert(schema.destinations).values({ id: destinationId, orgId, label: "Wallet", address: wallet, ...destinationOverrides });
  return { orgId, userId, destinationId, request: { orgId, userId, asset: "USDC" as const, amountBase: 10_000_000n, receiveAsset: "USDC" as const, destinationId } };
}

describe("a payout's quote", () => {
  it("is refused when its signature doesn't verify", async () => {
    const { request } = await payoutSetup();
    setProviderForTests(tampered((r) => { r.quote.depositAddress = "attacker-routing-address"; }));
    await expect(preparePayout(request)).rejects.toMatchObject({ code: "quote_signature" });
  });

  it("is refused when it pays someone else, even correctly signed", async () => {
    const { request } = await payoutSetup();
    setProviderForTests(resigned((r) => { r.quoteRequest.recipient = "attacker.near"; }));
    await expect(preparePayout(request)).rejects.toMatchObject({ code: "quote_mismatch" });
  });

  it("is refused when it takes more than asked", async () => {
    const { request } = await payoutSetup();
    setProviderForTests(resigned((r) => { r.quote.amountIn = "99000000"; }));
    await expect(preparePayout(request)).rejects.toMatchObject({ code: "quote_mismatch" });
  });

  it("is refused for nothing at all", async () => {
    const { request } = await payoutSetup();
    await expect(preparePayout({ ...request, amountBase: 0n })).rejects.toMatchObject({ status: 400 });
  });
});

describe("a payout at send time", () => {
  it("is refused if what's stored no longer says what was quoted, whoever changed it", async () => {
    const { orgId, userId, request } = await payoutSetup();
    const prepared = await preparePayout(request);
    const changed = prepared.payload.replace('"10000000"', '"90000000"');
    expect(changed).not.toBe(prepared.payload);
    await db().update(schema.payouts).set({ intent: { standard: "erc191", payload: changed } }).where(eq(schema.payouts.id, prepared.id));
    await expect(submitPayout({ orgId, payoutId: prepared.id, signature: await merchant.signMessage({ message: changed }), userId })).rejects.toMatchObject({ code: "intent_mismatch" });
  });

  it("is refused after the wallet changed", async () => {
    const { orgId, userId, request } = await payoutSetup();
    const prepared = await preparePayout(request);
    const signature = await merchant.signMessage({ message: prepared.payload });
    await db().update(schema.organizations).set({ walletAddress: stranger.address.toLowerCase() }).where(eq(schema.organizations.id, orgId));
    await expect(submitPayout({ orgId, payoutId: prepared.id, signature, userId })).rejects.toMatchObject({ code: "wallet_changed" });
  });

  it("returns the first result when it was already sent", async () => {
    const { orgId, userId, request } = await payoutSetup();
    const prepared = await preparePayout(request);
    const signature = await merchant.signMessage({ message: prepared.payload });
    await submitPayout({ orgId, payoutId: prepared.id, signature, userId });
    await applyPayoutStatus(prepared.id, { status: "SUCCESS", updatedAt: new Date().toISOString(), swapDetails: { amountOut: "1000000000000000000000", originChainTxHashes: [], destinationChainTxHashes: [] } });
    const again = await submitPayout({ orgId, payoutId: prepared.id, signature, userId });
    expect(again.state).toBe("sent");
    expect((await provider().balances(wallet, [ASSETS.USDC.assetId]))[0]).toBe("90000000");
  });
});

describe("a stored destination", () => {
  const OTHER = "0x000000000000000000000000000000000000dEaD";

  it("needs the current wallet's signature, not anyone's", async () => {
    const orgFixture = await payoutSetup();
    const message = issueChallenge("destination", orgFixture.orgId, OTHER);
    await db().update(schema.destinations).set({ address: OTHER, message, signature: await stranger.signMessage({ message }) }).where(eq(schema.destinations.id, orgFixture.destinationId));
    await expect(preparePayout(orgFixture.request)).rejects.toMatchObject({ code: "destination_unconfirmed" });
  });

  it("needs a signature over that address, not another", async () => {
    const orgFixture = await payoutSetup();
    const message = issueChallenge("destination", orgFixture.orgId, "0x0000000000000000000000000000000000000001");
    await db().update(schema.destinations).set({ address: OTHER, message, signature: await merchant.signMessage({ message }) }).where(eq(schema.destinations.id, orgFixture.destinationId));
    await expect(preparePayout(orgFixture.request)).rejects.toMatchObject({ code: "destination_unconfirmed" });
  });

  it("is refused if it's on the sanctions list, or the route is paused", async () => {
    const { request } = await payoutSetup();
    await db().insert(schema.screenedAddresses).values({ address: wallet, source: "test" });
    await expect(preparePayout(request)).rejects.toMatchObject({ code: "not_permitted" });
    await db().delete(schema.screenedAddresses);
    await db().insert(schema.routeControls).values({ key: "asset:USDC", paused: true });
    await expect(preparePayout(request)).rejects.toMatchObject({ code: "route_paused" });
    await db().delete(schema.routeControls);
  });
});

describe("refunds", () => {
  async function settledPayment(amount = "50000000") {
    await fund(100_000_000n);
    const fixture = await createOrg({ walletAddress: wallet });
    const source = await loadSource(await createLink(fixture.orgId));
    const session = await createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: key() });
    await applyPaymentStatus(session.id, { status: "SUCCESS", updatedAt: new Date().toISOString(), swapDetails: { amountOut: amount, originChainTxHashes: [], destinationChainTxHashes: [] } });
    return { ...fixture, paymentId: session.id };
  }
  const SUCCESS = { status: "SUCCESS" as const, updatedAt: new Date().toISOString(), swapDetails: { amountOut: "1000000000000000000000", originChainTxHashes: [], destinationChainTxHashes: [] } };
  const asIntent = async (prepared: Awaited<ReturnType<typeof prepareRefund>>) => {
    if (prepared.kind !== "intent") throw new Error("expected an intent refund");
    return { prepared, signature: await merchant.signMessage({ message: prepared.payload }) };
  };

  it("can't reach another workspace's payment", async () => {
    const { paymentId } = await settledPayment();
    const other = await createOrg({ walletAddress: wallet });
    await expect(prepareRefund({ orgId: other.orgId, paymentId, userId: other.userId })).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a sanctioned customer wallet", async () => {
    const { orgId, userId, paymentId } = await settledPayment();
    await db().insert(schema.screenedAddresses).values({ address: CUSTOMER.toLowerCase(), source: "test" });
    await expect(prepareRefund({ orgId, paymentId, userId })).rejects.toMatchObject({ code: "not_permitted" });
    await db().delete(schema.screenedAddresses);
  });

  it("checks what's left again at send time, so two prepared refunds can't both go through", async () => {
    const { orgId, userId, paymentId } = await settledPayment();
    const first = await asIntent(await prepareRefund({ orgId, paymentId, amountBase: "30000000", userId }));
    const second = await asIntent(await prepareRefund({ orgId, paymentId, amountBase: "30000000", userId }));
    await submitRefund({ orgId, refundId: first.prepared.id, signature: first.signature, userId });
    await applyRefundStatus(first.prepared.id, SUCCESS);
    await expect(submitRefund({ orgId, refundId: second.prepared.id, signature: second.signature, userId })).rejects.toMatchObject({ code: "refund_too_large" });
  });

  it("sends once under concurrent clicks", async () => {
    const { orgId, userId, paymentId } = await settledPayment();
    const { prepared, signature } = await asIntent(await prepareRefund({ orgId, paymentId, userId }));
    const submitIntent = vi.fn(async () => ({ intentHash: "h" }));
    setProviderForTests(hostile({ submitIntent }));
    await Promise.allSettled(Array.from({ length: 4 }, () => submitRefund({ orgId, refundId: prepared.id, signature, userId })));
    expect(submitIntent).toHaveBeenCalledTimes(1);
  });
});

describe("adding a destination", () => {
  const OTHER = "0x000000000000000000000000000000000000dEaD";

  it("needs a signature over this address, in this workspace", async () => {
    const { orgId, userId } = await createOrg({ walletAddress: wallet });
    const forOther = issueChallenge("destination", orgId, "0x0000000000000000000000000000000000000001");
    await expect(addDestination({ orgId, userId, label: "x", address: OTHER, message: forOther, signature: await merchant.signMessage({ message: forOther }) })).rejects.toMatchObject({ code: "challenge_invalid" });
    const made = "Gateway account action\n\nAllow payouts to " + OTHER;
    await expect(addDestination({ orgId, userId, label: "x", address: OTHER, message: made, signature: await merchant.signMessage({ message: made }) })).rejects.toMatchObject({ code: "challenge_invalid" });
  });

  it("refuses a sanctioned address", async () => {
    const { orgId, userId } = await createOrg({ walletAddress: wallet });
    await db().insert(schema.screenedAddresses).values({ address: OTHER.toLowerCase(), source: "test" });
    const message = issueChallenge("destination", orgId, OTHER);
    await expect(addDestination({ orgId, userId, label: "x", address: OTHER, message, signature: await merchant.signMessage({ message }) })).rejects.toMatchObject({ code: "not_permitted" });
    await db().delete(schema.screenedAddresses);
  });
});

describe("a send whose outcome is unknown", () => {
  const pending = { status: "PENDING_DEPOSIT" as const, updatedAt: new Date().toISOString(), swapDetails: { originChainTxHashes: [], destinationChainTxHashes: [] } };
  const force = (table: typeof schema.payouts | typeof schema.refunds, id: string) => db().update(table).set({ nextPollAt: new Date(Date.now() - 1000), submitAttemptedAt: new Date(Date.now() - 120_000) }).where(eq(table.id, id));

  it("isn't marked failed because a resend was refused, which is what a duplicate of a landed send gets", async () => {
    const { orgId, userId, request } = await payoutSetup();
    const prepared = await preparePayout(request);
    setProviderForTests(hostile({ submitIntent: async () => { throw new ProviderUnavailable("timeout"); } }));
    await submitPayout({ orgId, payoutId: prepared.id, signature: await merchant.signMessage({ message: prepared.payload }), userId });

    setProviderForTests(hostile({ status: async () => pending, submitIntent: async () => { throw new ProviderRejected(400, "nonce already used"); } }));
    await force(schema.payouts, prepared.id);
    await pollDuePayouts();
    const [row] = await db().select().from(schema.payouts).where(eq(schema.payouts.id, prepared.id));
    expect(row.state).toBe("submitting");
    // Still reserved, so "try again" can't pay it twice.
    await expect(preparePayout({ ...request, amountBase: 95_000_000n })).rejects.toMatchObject({ code: "insufficient_available" });
  });

  const signedDeadline = (payload: string) => Date.parse((JSON.parse(payload) as { deadline: string }).deadline);

  it("isn't released at the signed deadline, because the status can lag behind one that landed just before it", async () => {
    const { orgId, userId, request } = await payoutSetup();
    const prepared = await preparePayout(request);
    setProviderForTests(hostile({ submitIntent: async () => { throw new ProviderUnavailable("timeout"); } }));
    await submitPayout({ orgId, payoutId: prepared.id, signature: await merchant.signMessage({ message: prepared.payload }), userId });
    setProviderForTests(null);
    const row = await applyPayoutStatus(prepared.id, pending, new Date(signedDeadline(prepared.payload) + 1000));
    expect(row?.state).toBe("submitting");
  });

  it("past that it fails, but stays reserved and watched, and a late success still counts", async () => {
    const { orgId, userId, request } = await payoutSetup();
    const prepared = await preparePayout(request);
    setProviderForTests(hostile({ submitIntent: async () => { throw new ProviderUnavailable("timeout"); } }));
    await submitPayout({ orgId, payoutId: prepared.id, signature: await merchant.signMessage({ message: prepared.payload }), userId });
    setProviderForTests(null);
    const after = new Date(signedDeadline(prepared.payload) + RELEASE_GRACE_MS + 1000);
    const row = await applyPayoutStatus(prepared.id, pending, after);
    expect(row?.state).toBe("failed");
    expect(row?.nextPollAt).not.toBeNull();
    await expect(preparePayout({ ...request, amountBase: 95_000_000n })).rejects.toMatchObject({ code: "insufficient_available" });
    const late = await applyPayoutStatus(prepared.id, { ...pending, status: "SUCCESS", swapDetails: { ...pending.swapDetails, amountOut: "1000000000000000000000" } }, new Date(after.getTime() + 60_000));
    expect(late?.state).toBe("sent");
  });

  it("does the same for a refund, and the payment goes back to settled meanwhile", async () => {
    await fund(100_000_000n);
    const { orgId, userId } = await createOrg({ walletAddress: wallet });
    const source = await loadSource(await createLink(orgId));
    const session = await createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: key() });
    await applyPaymentStatus(session.id, { ...pending, status: "SUCCESS", swapDetails: { amountOut: "50000000", originChainTxHashes: [], destinationChainTxHashes: [] } });
    const prepared = await prepareRefund({ orgId, paymentId: session.id, userId });
    if (prepared.kind !== "intent") throw new Error("expected an intent refund");
    const submitIntent = vi.fn(async (): Promise<{ intentHash: string }> => { throw new ProviderUnavailable("timeout"); });
    setProviderForTests(hostile({ submitIntent }));
    await submitRefund({ orgId, refundId: prepared.id, signature: await merchant.signMessage({ message: prepared.payload }), userId });

    setProviderForTests(hostile({ status: async () => pending, submitIntent }));
    await force(schema.refunds, prepared.id);
    await pollDueRefunds();
    expect(submitIntent).toHaveBeenCalledTimes(2);
    const [row] = await db().select().from(schema.refunds).where(eq(schema.refunds.id, prepared.id));
    expect(row.state).toBe("submitting");

    setProviderForTests(null);
    const deadline = signedDeadline(prepared.payload);
    expect((await applyRefundStatus(prepared.id, pending, new Date(deadline + 1000)))?.state).toBe("submitting");
    const closed = await applyRefundStatus(prepared.id, pending, new Date(deadline + RELEASE_GRACE_MS + 1000));
    expect(closed?.state).toBe("failed");
    expect(closed?.nextPollAt).not.toBeNull();
    expect((await db().select().from(schema.payments).where(eq(schema.payments.id, session.id)))[0].state).toBe("settled");
    await expect(prepareRefund({ orgId, paymentId: session.id, userId })).rejects.toMatchObject({ code: "refund_open" });
  });

  it.each([["payout"], ["refund"]])("judges a %s by when the status was read, not by when a slow resend finished", async (kind) => {
    const { orgId, userId, request } = await payoutSetup();
    let id: string;
    let payload: string;
    if (kind === "payout") {
      const prepared = await preparePayout(request);
      ({ id, payload } = prepared);
      setProviderForTests(hostile({ submitIntent: async () => { throw new ProviderUnavailable("timeout"); } }));
      await submitPayout({ orgId, payoutId: id, signature: await merchant.signMessage({ message: payload }), userId });
    } else {
      const source = await loadSource(await createLink(orgId));
      const session = await createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: key() });
      await applyPaymentStatus(session.id, { ...pending, status: "SUCCESS", swapDetails: { amountOut: "50000000", originChainTxHashes: [], destinationChainTxHashes: [] } });
      const prepared = await prepareRefund({ orgId, paymentId: session.id, userId });
      if (prepared.kind !== "intent") throw new Error("expected an intent refund");
      ({ id, payload } = prepared);
      setProviderForTests(hostile({ submitIntent: async () => { throw new ProviderUnavailable("timeout"); } }));
      await submitRefund({ orgId, refundId: id, signature: await merchant.signMessage({ message: payload }), userId });
    }
    const deadline = signedDeadline(payload);
    const table = kind === "payout" ? schema.payouts : schema.refunds;
    await db().update(table).set({ nextPollAt: new Date(Date.now() - 1000), submitAttemptedAt: new Date(deadline - 120_000) }).where(eq(table.id, id));
    // The clock runs while the resend hangs, carrying this past the deadline and the grace after the status was read.
    vi.useFakeTimers({ toFake: ["Date"], now: deadline - 1000 });
    setProviderForTests(hostile({
      status: async () => pending,
      submitIntent: async () => {
        vi.setSystemTime(deadline + RELEASE_GRACE_MS + 60_000);
        throw new ProviderRejected(400, "nonce already used");
      },
    }));
    try {
      await (kind === "payout" ? pollDuePayouts() : pollDueRefunds());
    } finally {
      vi.useRealTimers();
    }
    const [row] = await db().select().from(table).where(eq(table.id, id));
    expect(row.state).toBe("submitting");
  });
});

describe("a response that arrives after the poller already moved on", () => {
  const SUCCESS = { status: "SUCCESS" as const, updatedAt: new Date().toISOString(), swapDetails: { amountOut: "1000000000000000000000", originChainTxHashes: [], destinationChainTxHashes: [] } };

  it("can't count a refund twice", async () => {
    await fund(100_000_000n);
    const { orgId, userId } = await createOrg({ walletAddress: wallet });
    const source = await loadSource(await createLink(orgId));
    const session = await createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: key() });
    await applyPaymentStatus(session.id, { ...SUCCESS, swapDetails: { amountOut: "50000000", originChainTxHashes: [], destinationChainTxHashes: [] } });
    const prepared = await prepareRefund({ orgId, paymentId: session.id, amountBase: "10000000", userId });
    if (prepared.kind !== "intent") throw new Error("expected an intent refund");
    // The send's response is slow, and the poller sees it finish first.
    setProviderForTests(hostile({ submitIntent: async () => { await applyRefundStatus(prepared.id, SUCCESS); return { intentHash: "late" }; } }));
    const row = await submitRefund({ orgId, refundId: prepared.id, signature: await merchant.signMessage({ message: prepared.payload }), userId });
    expect(row.state).toBe("refunded");
    await applyRefundStatus(prepared.id, SUCCESS);
    expect((await db().select().from(schema.payments).where(eq(schema.payments.id, session.id)))[0].refundedBase).toBe("10000000");
  });

  it("can't reopen a payout that already went", async () => {
    const { orgId, userId, request } = await payoutSetup();
    const prepared = await preparePayout(request);
    setProviderForTests(hostile({ submitIntent: async () => { await applyPayoutStatus(prepared.id, SUCCESS); return { intentHash: "late" }; } }));
    const row = await submitPayout({ orgId, payoutId: prepared.id, signature: await merchant.signMessage({ message: prepared.payload }), userId });
    expect(row.state).toBe("sent");
  });
});

describe("a failure that may yet go through", () => {
  const FAILED = { status: "FAILED" as const, updatedAt: new Date().toISOString(), swapDetails: { originChainTxHashes: [], destinationChainTxHashes: [] } };
  const REFUNDED = { ...FAILED, status: "REFUNDED" as const };
  const SUCCESS = { ...FAILED, status: "SUCCESS" as const, swapDetails: { ...FAILED.swapDetails, amountOut: "1000000000000000000000" } };

  async function refundInFlight() {
    await fund(100_000_000n);
    const { orgId, userId } = await createOrg({ walletAddress: wallet });
    const source = await loadSource(await createLink(orgId));
    const session = await createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: key() });
    await applyPaymentStatus(session.id, { ...SUCCESS, swapDetails: { amountOut: "50000000", originChainTxHashes: [], destinationChainTxHashes: [] } });
    const prepared = await prepareRefund({ orgId, paymentId: session.id, userId });
    if (prepared.kind !== "intent") throw new Error("expected an intent refund");
    await submitRefund({ orgId, refundId: prepared.id, signature: await merchant.signMessage({ message: prepared.payload }), userId });
    return { orgId, userId, paymentId: session.id, refundId: prepared.id };
  }

  it("blocks a new refund and keeps watching, because a late success would pay twice", async () => {
    const { orgId, userId, paymentId, refundId } = await refundInFlight();
    const row = await applyRefundStatus(refundId, FAILED);
    expect(row?.state).toBe("failed");
    expect(row?.nextPollAt).not.toBeNull();
    await expect(prepareRefund({ orgId, paymentId, userId })).rejects.toMatchObject({ code: "refund_open" });
    await applyRefundStatus(refundId, SUCCESS);
    const payment = (await db().select().from(schema.payments).where(eq(schema.payments.id, paymentId)))[0];
    expect(payment.state).toBe("refunded");
  });

  it("frees the refund once the route confirms the money came back", async () => {
    const { orgId, userId, paymentId, refundId } = await refundInFlight();
    await applyRefundStatus(refundId, FAILED);
    const row = await applyRefundStatus(refundId, REFUNDED);
    expect(row?.nextPollAt).toBeNull();
    await expect(prepareRefund({ orgId, paymentId, userId })).resolves.toBeTruthy();
  });

  it("keeps a failed payout's funds reserved while it's watched", async () => {
    const { orgId, userId, request } = await payoutSetup();
    const prepared = await preparePayout(request);
    await submitPayout({ orgId, payoutId: prepared.id, signature: await merchant.signMessage({ message: prepared.payload }), userId });
    await fund(100_000_000n);
    await applyPayoutStatus(prepared.id, FAILED);
    await expect(preparePayout({ ...request, amountBase: 95_000_000n })).rejects.toMatchObject({ code: "insufficient_available" });
    await applyPayoutStatus(prepared.id, REFUNDED);
    await expect(preparePayout({ ...request, amountBase: 95_000_000n })).resolves.toBeTruthy();
  });
});

describe("what SUCCESS actually delivered", () => {
  const success = (details: Record<string, unknown>) => ({ status: "SUCCESS" as const, updatedAt: new Date().toISOString(), swapDetails: { originChainTxHashes: [], destinationChainTxHashes: [], ...details } });
  async function open() {
    const { orgId } = await createOrg({ walletAddress: wallet });
    const source = await loadSource(await createLink(orgId));
    const session = await createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: key() });
    return { orgId, id: session.id };
  }

  it("isn't settled with nothing delivered", async () => {
    const { orgId, id } = await open();
    const row = await applyPaymentStatus(id, success({ amountOut: "0" }));
    expect(row?.state).toBe("underpaid");
    expect((await db().select().from(schema.outbox).where(eq(schema.outbox.orgId, orgId))).map((event) => event.type)).not.toContain("payment.settled");
  });

  it("isn't settled when the amount is missing, and isn't assumed to be in full", async () => {
    const { id } = await open();
    const row = await applyPaymentStatus(id, success({}));
    expect(row?.state).toBe("awaiting_deposit");
    expect(row?.receivedBase).toBeNull();
    expect(row?.nextPollAt).not.toBeNull();
  });

  it("can't be refunded automatically when it arrived short", async () => {
    const { orgId, id } = await open();
    await applyPaymentStatus(id, success({ amountOut: "1" }));
    const [{ userId }] = await db().select({ userId: schema.memberships.userId }).from(schema.memberships).where(eq(schema.memberships.orgId, orgId));
    await expect(prepareRefund({ orgId, paymentId: id, userId })).rejects.toMatchObject({ code: "not_refundable" });
  });
});

describe("a checkout's reload", () => {
  it("knows the customer already sent, so the pay button can't come back", async () => {
    const { orgId } = await createOrg({ walletAddress: wallet });
    const source = await loadSource(await createLink(orgId));
    const session = await createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: key() });
    expect(session.depositSubmitted).toBe(false);
    await db().update(schema.payments).set({ clientTxHash: "0xcustomer" }).where(eq(schema.payments.id, session.id));
    expect(publicSession(await loadSession(session.id)).depositSubmitted).toBe(true);
  });
});

describe("a payment from the other mode", () => {
  const moneyWallet = { walletAddress: wallet };
  const success = { status: "SUCCESS" as const, updatedAt: new Date().toISOString(), swapDetails: { amountOut: "50000000", originChainTxHashes: [], destinationChainTxHashes: [] } };
  const settled = async () => {
    const { orgId, userId } = await createOrg(moneyWallet);
    const source = await loadSource(await createLink(orgId));
    const session = await createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: key() });
    await applyPaymentStatus(session.id, success);
    return { orgId, userId, paymentId: session.id };
  };

  it("can't be refunded with real money once this server is live, because it never happened", async () => {
    const { orgId, userId, paymentId } = await settled();
    setProviderForTests(Object.assign(hostile({}), { kind: "oneclick" }) as SwapProvider);
    await expect(prepareRefund({ orgId, paymentId, userId })).rejects.toMatchObject({ code: "not_refundable" });
  });

  it("can't be refunded by a simulator if it was real", async () => {
    const { orgId, userId, paymentId } = await settled();
    await db().update(schema.payments).set({ live: true }).where(eq(schema.payments.id, paymentId));
    await expect(prepareRefund({ orgId, paymentId, userId })).rejects.toMatchObject({ code: "not_refundable" });
  });

  it("can't be signed across a mode change", async () => {
    await fund(100_000_000n);
    const { orgId, userId, paymentId } = await settled();
    const refund = await prepareRefund({ orgId, paymentId, userId });
    if (refund.kind !== "intent") throw new Error("expected an intent refund");
    await db().update(schema.refunds).set({ live: true }).where(eq(schema.refunds.id, refund.id));
    await expect(submitRefund({ orgId, refundId: refund.id, signature: await merchant.signMessage({ message: refund.payload }), userId })).rejects.toMatchObject({ code: "refund_expired" });

    const setup = await payoutSetup();
    const payout = await preparePayout(setup.request);
    await db().update(schema.payouts).set({ live: true }).where(eq(schema.payouts.id, payout.id));
    await expect(submitPayout({ orgId: setup.orgId, payoutId: payout.id, signature: await merchant.signMessage({ message: payout.payload }), userId: setup.userId })).rejects.toMatchObject({ code: "payout_expired" });
  });
});

describe("a refund that doesn't complete", () => {
  const base = { updatedAt: new Date().toISOString(), swapDetails: { originChainTxHashes: [], destinationChainTxHashes: [] } };
  const FAILED = { ...base, status: "FAILED" as const };
  const PENDING = { ...base, status: "PENDING_DEPOSIT" as const };
  const SUCCESS = { ...base, status: "SUCCESS" as const, swapDetails: { ...base.swapDetails, amountOut: "1000000000000000000000" } };

  async function refundable() {
    await fund(100_000_000n);
    const { orgId, userId } = await createOrg({ walletAddress: wallet });
    const source = await loadSource(await createLink(orgId));
    const session = await createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: key() });
    await applyPaymentStatus(session.id, { ...SUCCESS, swapDetails: { ...SUCCESS.swapDetails, amountOut: "50000000" } });
    return { orgId, userId, paymentId: session.id };
  }
  const sign = async (fixture: { orgId: string; userId: string }, refund: { id: string; payload: string }) => submitRefund({ orgId: fixture.orgId, refundId: refund.id, signature: await merchant.signMessage({ message: refund.payload }), userId: fixture.userId });
  const prepared = async (input: Parameters<typeof prepareRefund>[0]) => {
    const refund = await prepareRefund(input);
    if (refund.kind !== "intent") throw new Error("expected an intent refund");
    return refund;
  };
  const alerts = async (orgId: string, type: string) => (await db().select().from(schema.outbox).where(eq(schema.outbox.orgId, orgId))).filter((event) => event.type === type);

  it("tells the merchant, once, because the customer is still waiting", async () => {
    const fixture = await refundable();
    const refund = await prepared(fixture);
    await sign(fixture, refund);
    await applyRefundStatus(refund.id, FAILED);
    await applyRefundStatus(refund.id, FAILED);
    expect(await alerts(fixture.orgId, "alert.refund_failed")).toHaveLength(1);
  });

  it("tells the merchant when the first send is refused outright", async () => {
    const fixture = await refundable();
    const refund = await prepared(fixture);
    setProviderForTests(hostile({ submitIntent: async () => { throw new ProviderRejected(400, "no"); } }));
    expect((await sign(fixture, refund)).state).toBe("failed");
    expect(await alerts(fixture.orgId, "alert.refund_failed")).toHaveLength(1);
  });

  it("tells the merchant when it expires past its signed deadline", async () => {
    const fixture = await refundable();
    const refund = await prepared(fixture);
    await sign(fixture, refund);
    const deadline = Date.parse((JSON.parse(refund.payload) as { deadline: string }).deadline);
    await applyRefundStatus(refund.id, PENDING, new Date(deadline + RELEASE_GRACE_MS + 1000));
    expect(await alerts(fixture.orgId, "alert.refund_failed")).toHaveLength(1);
  });

  it("can't be followed by a side-by-side refund that was prepared earlier, while it could still land", async () => {
    const fixture = await refundable();
    const first = await prepared({ ...fixture, amountBase: "10000000" });
    const second = await prepared({ ...fixture, amountBase: "10000000" });
    await sign(fixture, first);
    await applyRefundStatus(first.id, FAILED);
    await expect(sign(fixture, second)).rejects.toMatchObject({ code: "refund_open" });
  });

  it("isn't counted without proof of what arrived, and a shortfall tells the merchant", async () => {
    const fixture = await refundable();
    const refund = await prepared({ ...fixture, amountBase: "10000000" });
    await sign(fixture, refund);
    expect((await applyRefundStatus(refund.id, { ...base, status: "SUCCESS" }))?.state).toBe("processing");
    expect((await db().select().from(schema.payments).where(eq(schema.payments.id, fixture.paymentId)))[0].refundedBase).toBe("0");
    const done = await applyRefundStatus(refund.id, { ...base, status: "SUCCESS", swapDetails: { ...base.swapDetails, amountOut: "1" } });
    expect(done?.state).toBe("refunded");
    expect(await alerts(fixture.orgId, "alert.refund_failed")).toHaveLength(1);
  });

  it("watches for a day from when it failed, not from when it was made", async () => {
    const fixture = await refundable();
    const refund = await prepared(fixture);
    await sign(fixture, refund);
    await db().update(schema.refunds).set({ createdAt: new Date(Date.now() - 3 * WATCH_FAILED_MS) }).where(eq(schema.refunds.id, refund.id));
    const failed = await applyRefundStatus(refund.id, FAILED);
    expect(failed?.nextPollAt).not.toBeNull();
    const later = await applyRefundStatus(refund.id, FAILED, new Date(Date.now() + WATCH_FAILED_MS + 60_000));
    expect(later?.nextPollAt).toBeNull();
  });
});

describe("a payout that doesn't complete", () => {
  const base = { updatedAt: new Date().toISOString(), swapDetails: { originChainTxHashes: [], destinationChainTxHashes: [] } };
  const FAILED = { ...base, status: "FAILED" as const };
  const started = async () => {
    const setup = await payoutSetup();
    const prepared = await preparePayout(setup.request);
    await submitPayout({ orgId: setup.orgId, payoutId: prepared.id, signature: await merchant.signMessage({ message: prepared.payload }), userId: setup.userId });
    return { ...setup, id: prepared.id };
  };

  it("doesn't say it's safe to retry while it could still go through", async () => {
    const { id } = await started();
    const failed = await applyPayoutStatus(id, FAILED);
    expect(failed?.failureReason).not.toMatch(/stayed in your balance/);
    expect(toPayout(failed as NonNullable<typeof failed>).watching).toBe(true);
    const back = await applyPayoutStatus(id, { ...base, status: "REFUNDED" });
    expect(toPayout(back as NonNullable<typeof back>).watching).toBeUndefined();
  });

  it("watches for a day from when it failed, not from when it was made", async () => {
    const { id } = await started();
    await db().update(schema.payouts).set({ createdAt: new Date(Date.now() - 3 * WATCH_FAILED_MS) }).where(eq(schema.payouts.id, id));
    expect((await applyPayoutStatus(id, FAILED))?.nextPollAt).not.toBeNull();
    expect((await applyPayoutStatus(id, FAILED, new Date(Date.now() + WATCH_FAILED_MS + 60_000)))?.nextPollAt).toBeNull();
  });

  it("keeps watching past the day if the provider says it's moving again, and it still counts", async () => {
    const { id } = await started();
    await applyPayoutStatus(id, FAILED);
    const later = new Date(Date.now() + 3 * WATCH_FAILED_MS);
    expect((await applyPayoutStatus(id, { ...base, status: "PROCESSING" }, later))?.nextPollAt).not.toBeNull();
    const done = await applyPayoutStatus(id, { ...base, status: "SUCCESS", swapDetails: { ...base.swapDetails, amountOut: "1000000000000000000000" } }, later);
    expect(done?.state).toBe("sent");
  });

  it("isn't sent without proof of what arrived, and a shortfall tells the merchant", async () => {
    const { orgId, id } = await started();
    expect((await applyPayoutStatus(id, { ...base, status: "SUCCESS" }))?.state).not.toBe("sent");
    const done = await applyPayoutStatus(id, { ...base, status: "SUCCESS", swapDetails: { ...base.swapDetails, amountOut: "1" } });
    expect(done?.state).toBe("sent");
    const types = (await db().select().from(schema.outbox).where(eq(schema.outbox.orgId, orgId))).map((event) => event.type);
    expect(types).toContain("alert.payout_short");
  });
});

describe("a quote carrying more than was asked", () => {
  it.each<[string, (r: QuoteResponse) => void]>([
    ["wider slippage", (r) => { r.quoteRequest.slippageTolerance = 5000; }],
    ["a message for the recipient", (r) => { (r.quoteRequest as Record<string, unknown>).customRecipientMsg = "x"; }],
    ["a virtual chain recipient", (r) => { (r.quoteRequest as Record<string, unknown>).virtualChainRecipient = "x"; }],
    ["a virtual chain refund recipient", (r) => { (r.quoteRequest as Record<string, unknown>).virtualChainRefundRecipient = "x"; }],
  ])("is refused: %s", async (_, change) => {
    await expect(checkoutAttempt(resigned(change))).rejects.toMatchObject({ code: "quote_mismatch" });
  });
});
