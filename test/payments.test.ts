import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { db, schema } from "@/server/db";
import { createSession, loadSession, previewQuote } from "@/server/payments/checkout";
import { applyPaymentStatus, pollDuePayments } from "@/server/payments/poller";
import { provider, setProviderForTests } from "@/server/payments/provider";
import { SimProvider, SIM_STEP_MS } from "@/server/payments/provider/sim";
import { ProviderRejected, ProviderUnavailable, type QuoteRequest, type QuoteResponse, type StatusResponse, type SwapProvider } from "@/server/payments/provider/types";
import { loadSource } from "@/server/payments/source";
import { applyPayoutStatus, preparePayout, submitPayout } from "@/server/payments/payouts";
import { applyRefundStatus, prepareRefund, submitRefund } from "@/server/payments/refunds";
import { addDestination, issueChallenge, setSettlementWallet } from "@/server/payments/wallet";
import { ASSETS } from "@/lib/assets";
import { checkTransferPayload } from "@/lib/intents";
import { createLink, createOrg, freshDatabase, paymentById, WALLET_KEY } from "./support/db";

const merchant = privateKeyToAccount(WALLET_KEY);
const wallet = merchant.address.toLowerCase();
const stranger = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ea870594951c6ec0c7c1ac5");
const CUSTOMER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const key = () => randomBytes(8).toString("hex");

const status = (name: StatusResponse["status"], details: Partial<StatusResponse["swapDetails"]> = {}): StatusResponse => ({
  status: name,
  updatedAt: new Date().toISOString(),
  swapDetails: { originChainTxHashes: [], destinationChainTxHashes: [], ...details },
});

let close: () => Promise<void>;
beforeAll(async () => {
  ({ close } = await freshDatabase());
});
afterAll(async () => close());
afterEach(() => setProviderForTests(null));

async function merchantOrg(overrides: Partial<typeof schema.organizations.$inferInsert> = {}) {
  return createOrg({ walletAddress: wallet, walletVerifiedAt: new Date(), ...overrides });
}

async function session(orgId: string, overrides: Partial<Parameters<typeof createSession>[1]> = {}, linkOverrides = {}) {
  const linkId = await createLink(orgId, linkOverrides);
  const source = await loadSource(linkId);
  return { source, linkId, result: await createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: key(), ...overrides }) };
}

/** Wraps the simulator so a test can make one call behave badly. */
function hostile(overrides: Partial<SwapProvider>): SwapProvider {
  const sim = provider();
  return Object.assign(Object.create(Object.getPrototypeOf(sim)), sim, overrides, { kind: "sim", quoteKey: sim.quoteKey }) as SwapProvider;
}

describe("sim mode by default", () => {
  it("never reaches the real provider unless every live gate passes", async () => {
    const { resetEnv, paymentsMode, liveGateFailures, LIVE_ACK_PHRASE } = await import("@/server/env");
    const before = { ...process.env };
    expect(paymentsMode()).toBe("sim");
    Object.assign(process.env, { PAYMENTS_MODE: "live" });
    resetEnv();
    expect(paymentsMode()).toBe("sim");
    expect(liveGateFailures().length).toBe(2);
    Object.assign(process.env, { ONECLICK_API_KEY: "k" });
    resetEnv();
    expect(paymentsMode()).toBe("sim");
    Object.assign(process.env, { LIVE_PAYMENTS_ACK: "yes" });
    resetEnv();
    expect(paymentsMode()).toBe("sim");
    Object.assign(process.env, { LIVE_PAYMENTS_ACK: LIVE_ACK_PHRASE });
    resetEnv();
    expect(paymentsMode()).toBe("live");
    Object.assign(process.env, { APP_FEE_BPS: "30" });
    resetEnv();
    expect(paymentsMode()).toBe("sim");
    process.env = before;
    resetEnv();
  });
});

describe("checkout", () => {
  it("quotes the merchant's exact amount and tracks the address from the first moment", async () => {
    const { orgId } = await merchantOrg();
    const { result } = await session(orgId);
    expect(result.state).toBe("awaiting_deposit");
    expect(result.receiveAmount).toBe("50");
    expect(result.depositAddress).toMatch(/^sim_/);
    const row = await paymentById(result.id);
    expect(row.nextPollAt).not.toBeNull();
    expect(row.quote).toBeTruthy();
    expect(row.recipient).toBe(wallet);
    expect(row.recipientType).toBe("INTENTS");
    expect(row.payer).toBe(CUSTOMER);
  });

  it("returns the same address when the request repeats", async () => {
    const { orgId } = await merchantOrg();
    const linkId = await createLink(orgId);
    const source = await loadSource(linkId);
    const idempotencyKey = key();
    const first = await createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey });
    const second = await createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey });
    expect(second.depositAddress).toBe(first.depositAddress);
    expect((await db().select().from(schema.payments).where(eq(schema.payments.sourceId, linkId))).length).toBe(1);
  });

  it("issues one address under concurrent repeats", async () => {
    const { orgId } = await merchantOrg();
    const source = await loadSource(await createLink(orgId));
    const idempotencyKey = key();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey })));
    const addresses = new Set(results.flatMap((r) => (r.status === "fulfilled" ? [r.value.depositAddress] : [])));
    expect(addresses.size).toBe(1);
    expect((await db().select().from(schema.simSwaps)).filter((s) => addresses.has(s.depositAddress)).length).toBe(1);
  });

  it("refuses a key reused for a different request", async () => {
    const { orgId } = await merchantOrg();
    const source = await loadSource(await createLink(orgId));
    const idempotencyKey = key();
    await createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey });
    await expect(createSession(source, { payAsset: "ARB", refundAddress: CUSTOMER, idempotencyKey })).rejects.toMatchObject({ code: "idempotency_mismatch" });
  });

  it("refuses a closed source, and a merchant with no wallet", async () => {
    const { orgId } = await merchantOrg();
    await expect(session(orgId, {}, { status: "paused" })).rejects.toMatchObject({ code: "source_closed" });
    await expect(session(orgId, {}, { expiresAt: new Date(Date.now() - 1000) })).rejects.toMatchObject({ code: "source_closed" });
    const bare = await createOrg();
    await expect(session(bare.orgId)).rejects.toMatchObject({ code: "source_closed" });
  });

  it("refuses a refund address that is wrong for the chain", async () => {
    const { orgId } = await merchantOrg();
    await expect(session(orgId, { payAsset: "SOL", refundAddress: CUSTOMER })).rejects.toMatchObject({ code: "refund_address_invalid" });
    await expect(session(orgId, { refundAddress: "not-an-address" })).rejects.toMatchObject({ code: "refund_address_invalid" });
  });

  it("enforces NEAR's route minimums before asking for a quote", async () => {
    const { orgId } = await merchantOrg();
    const quote = vi.fn();
    setProviderForTests(hostile({ quote }));
    await expect(session(orgId, { payAsset: "BNB" })).rejects.toMatchObject({ code: "route_minimum" });
    await expect(session(orgId, { payAsset: "USDT", refundAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" })).rejects.toMatchObject({ code: "route_minimum" });
    expect(quote).not.toHaveBeenCalled();
  });

  it("accepts a route once the amount clears its minimum", async () => {
    const { orgId } = await merchantOrg();
    const { result } = await session(orgId, { payAsset: "USDT", refundAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" }, { amountUsd: "150.00" });
    expect(result.state).toBe("awaiting_deposit");
  });

  it("refuses a paused route and resumes once it reopens", async () => {
    const { orgId } = await merchantOrg();
    await db().insert(schema.routeControls).values({ key: "chain:eth", paused: true, reason: "test" });
    await expect(session(orgId)).rejects.toMatchObject({ code: "route_paused" });
    await db().delete(schema.routeControls).where(eq(schema.routeControls.key, "chain:eth"));
    await db().insert(schema.routeControls).values({ key: "payments", paused: true });
    await expect(session(orgId)).rejects.toMatchObject({ code: "route_paused" });
    await db().delete(schema.routeControls).where(eq(schema.routeControls.key, "payments"));
    await expect(session(orgId)).resolves.toBeTruthy();
  });

  it("refuses a sanctioned wallet with a neutral message, and records it", async () => {
    const { orgId } = await merchantOrg();
    await db().insert(schema.screenedAddresses).values({ address: CUSTOMER.toLowerCase(), source: "test" });
    await expect(session(orgId)).rejects.toMatchObject({ code: "not_permitted", message: "This wallet can't be used here." });
    const logged = await db().select().from(schema.auditLog).where(eq(schema.auditLog.action, "screening.blocked"));
    expect(logged.length).toBeGreaterThan(0);
    await db().delete(schema.screenedAddresses);
  });

  it("enforces the amount rules", async () => {
    const { orgId } = await merchantOrg();
    const open = await loadSource(await createLink(orgId, { amountUsd: null }));
    await expect(createSession(open, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: key() })).rejects.toMatchObject({ code: "amount_required" });
    await expect(createSession(open, { payAsset: "ETH", amount: 0.5, refundAddress: CUSTOMER, idempotencyKey: key() })).rejects.toMatchObject({ code: "amount_too_small" });
    await expect(createSession(open, { payAsset: "ETH", amount: 5_000_000, refundAddress: CUSTOMER, idempotencyKey: key() })).rejects.toMatchObject({ code: "amount_too_large" });
    const fixed = await loadSource(await createLink(orgId));
    await expect(createSession(fixed, { payAsset: "ETH", amount: 1, refundAddress: CUSTOMER, idempotencyKey: key() })).rejects.toMatchObject({ code: "amount_fixed" });
  });

  it("direct mode pays the verified wallet, and refuses assets on other kinds of chain", async () => {
    const { orgId } = await merchantOrg({ settlementMode: "direct" });
    const { result } = await session(orgId);
    const row = await paymentById(result.id);
    expect(row.recipientType).toBe("DESTINATION_CHAIN");
    expect(row.recipient).toBe(wallet);
    await expect(session(orgId, {}, { receiveAsset: "NEAR" })).rejects.toMatchObject({ code: "receive_asset_unsupported" });
  });

  it("previews without issuing an address", async () => {
    const { orgId } = await merchantOrg();
    const source = await loadSource(await createLink(orgId));
    const before = (await db().select().from(schema.simSwaps)).length;
    const preview = await previewQuote(source, { payAsset: "ETH" });
    expect(preview.feeUsd).toBeGreaterThan(0);
    expect((await db().select().from(schema.simSwaps)).length).toBe(before);
  });
});

describe("quote guards, with a provider returning hostile quotes", () => {
  const tamperQuote = (fn: (response: QuoteResponse) => void) => {
    const sim = new SimProvider();
    return hostile({
      quote: async (request: QuoteRequest) => {
        const response = await sim.quote(request);
        fn(response);
        return response;
      },
    });
  };

  async function refused(fn: (response: QuoteResponse) => void, code: string) {
    const { orgId } = await merchantOrg();
    const source = await loadSource(await createLink(orgId));
    setProviderForTests(tamperQuote(fn));
    const attempt = createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: key() });
    await expect(attempt).rejects.toMatchObject({ code });
    const [row] = await db().select().from(schema.payments).where(eq(schema.payments.sourceId, source.id));
    // The customer never sees an address, and the attempt can't poll.
    expect(row.state).toBe("quote_failed");
    expect(row.depositAddress).toBeNull();
    expect(row.nextPollAt).toBeNull();
    setProviderForTests(null);
  }

  it.each<[string, (r: QuoteResponse) => void]>([
    ["a different recipient", (r) => { r.quoteRequest.recipient = "attacker.near"; }],
    ["a different recipient type", (r) => { r.quoteRequest.recipientType = "DESTINATION_CHAIN"; }],
    ["a different refund address", (r) => { r.quoteRequest.refundTo = "0x000000000000000000000000000000000000dEaD"; }],
    ["a different amount", (r) => { r.quoteRequest.amount = "1"; }],
    ["a different asset", (r) => { r.quoteRequest.destinationAsset = "nep141:wrap.near"; }],
    ["a dropped output amount", (r) => { r.quote.amountOut = "1"; }],
    ["a surprise fee", (r) => { r.quoteRequest.appFees = [{ recipient: "x.near", fee: 500 }]; }],
  ])("refuses a quote echoing %s", async (_, fn) => {
    await refused(fn, "quote_mismatch");
  });

  it("refuses a quote whose signature doesn't verify", async () => {
    await refused((r) => { r.quote.depositAddress = "0xattacker"; }, "quote_signature");
  });

  it("turns a provider refusal into a clean error with no address", async () => {
    const { orgId } = await merchantOrg();
    const source = await loadSource(await createLink(orgId));
    setProviderForTests(hostile({ quote: async () => { throw new ProviderRejected(400, "refundTo is not valid"); } }));
    await expect(createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: key() })).rejects.toMatchObject({ code: "route_unavailable" });
  });

  it("treats a provider outage as unavailable, not as a failed payment to a customer", async () => {
    const { orgId } = await merchantOrg();
    const source = await loadSource(await createLink(orgId));
    setProviderForTests(hostile({ quote: async () => { throw new ProviderUnavailable("down"); } }));
    await expect(createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: key() })).rejects.toMatchObject({ code: "provider_unavailable" });
  });
});

describe("lifecycle against the simulator", () => {
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("settles, credits the merchant's balance and emits exactly one settled event", async () => {
    const { orgId } = await merchantOrg();
    const { result } = await session(orgId);
    const sim = provider() as SimProvider;
    await sim.simulateDeposit(result.depositAddress as string, "pay");

    let row = await applyPaymentStatus(result.id, await sim.status(result.depositAddress as string));
    expect(row?.state).toBe("deposit_seen");
    await wait(SIM_STEP_MS.processing + 50);
    row = await applyPaymentStatus(result.id, await sim.status(result.depositAddress as string));
    expect(row?.state).toBe("processing");
    await wait(SIM_STEP_MS.success + 50);
    row = await applyPaymentStatus(result.id, await sim.status(result.depositAddress as string));
    expect(row?.state).toBe("settled");
    expect(row?.receivedBase).toBe("50000000");
    expect(row?.settledAt).not.toBeNull();
    expect((await sim.balances(wallet, [ASSETS.USDC.assetId]))[0]).toBe("50000000");

    // A repeated reading changes nothing.
    await applyPaymentStatus(result.id, await sim.status(result.depositAddress as string));
    const events = await db().select().from(schema.outbox).where(eq(schema.outbox.orgId, orgId));
    expect(events.filter((event) => event.type === "payment.settled").length).toBe(1);
    expect((await db().select().from(schema.paymentEvents).where(eq(schema.paymentEvents.paymentId, result.id))).map((e) => e.toState)).toEqual(["awaiting_deposit", "deposit_seen", "processing", "settled"]);
  }, 20_000);

  it("reports the provider returning a failed deposit to the customer", async () => {
    const { orgId } = await merchantOrg();
    const { result } = await session(orgId);
    const row = await applyPaymentStatus(result.id, status("REFUNDED", { refundedAmount: "123", refundReason: "PARTIAL_DEPOSIT" }));
    expect(row?.state).toBe("provider_refunded");
    expect(row?.providerRefundedBase).toBe("123");
    expect(row?.providerRefundReason).toBe("PARTIAL_DEPOSIT");
  });

  it("expires a quiet payment once the countdown ends, and moves it on if money arrives late", async () => {
    const { orgId } = await merchantOrg();
    const { result } = await session(orgId);
    await db().update(schema.payments).set({ payBy: new Date(Date.now() - 1000) }).where(eq(schema.payments.id, result.id));
    let row = await applyPaymentStatus(result.id, status("PENDING_DEPOSIT"));
    expect(row?.state).toBe("expired");
    expect(row?.nextPollAt).not.toBeNull();
    row = await applyPaymentStatus(result.id, status("SUCCESS", { amountOut: "50000000" }));
    expect(row?.state).toBe("settled");
    const types = (await db().select().from(schema.outbox).where(eq(schema.outbox.orgId, orgId))).map((event) => event.type);
    expect(types).toContain("payment.expired");
    expect(types).toContain("payment.settled");
  });

  it("flags a settlement below the quoted amount and records what really arrived", async () => {
    const { orgId } = await merchantOrg();
    const { result } = await session(orgId);
    const row = await applyPaymentStatus(result.id, status("SUCCESS", { amountOut: "40000000" }));
    expect(row?.receivedBase).toBe("40000000");
    const logged = await db().select().from(schema.auditLog).where(eq(schema.auditLog.target, result.id));
    expect(logged.map((entry) => entry.action)).toContain("payment.short_settlement");
  });

  it("flags a deposit that changes after a final outcome, without moving money records", async () => {
    const { orgId } = await merchantOrg();
    const { result } = await session(orgId);
    await applyPaymentStatus(result.id, status("SUCCESS", { amountOut: "50000000", depositedAmount: "100" }));
    const row = await applyPaymentStatus(result.id, status("SUCCESS", { amountOut: "50000000", depositedAmount: "200" }));
    expect(row?.state).toBe("settled");
    const types = (await db().select().from(schema.outbox).where(eq(schema.outbox.orgId, orgId))).map((event) => event.type);
    expect(types).toContain("alert.deposit_changed");
  });

  it("changes nothing but the schedule when the provider is down", async () => {
    const { orgId } = await merchantOrg();
    const { result } = await session(orgId);
    await db().update(schema.payments).set({ nextPollAt: new Date(Date.now() - 1000) }).where(eq(schema.payments.id, result.id));
    setProviderForTests(hostile({ status: async () => { throw new ProviderUnavailable("down"); } }));
    await pollDuePayments();
    const row = await paymentById(result.id);
    expect(row.state).toBe("awaiting_deposit");
    expect(row.pollFailures).toBe(1);
    expect(row.nextPollAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("polls only rows from the active mode, so real money is never asked of the simulator", async () => {
    const { orgId } = await merchantOrg();
    const { result } = await session(orgId);
    await db().update(schema.payments).set({ live: true, nextPollAt: new Date(Date.now() - 1000) }).where(eq(schema.payments.id, result.id));
    const statusCalled = vi.fn();
    setProviderForTests(hostile({ status: statusCalled as never }));
    await pollDuePayments();
    expect(statusCalled).not.toHaveBeenCalled();
    const row = await paymentById(result.id);
    expect(row.pollFailures).toBe(0);
    expect(row.nextPollAt!.getTime()).toBeLessThan(Date.now());
    await db().update(schema.payments).set({ nextPollAt: null }).where(eq(schema.payments.id, result.id));
  });

  it("gives a payment to one poller at a time", async () => {
    const { orgId } = await merchantOrg();
    const { result } = await session(orgId);
    await db().update(schema.payments).set({ nextPollAt: new Date(Date.now() - 1000) }).where(eq(schema.payments.id, result.id));
    const calls: string[] = [];
    setProviderForTests(hostile({ status: async (address) => { calls.push(address); return status("PENDING_DEPOSIT"); } }));
    await Promise.all([pollDuePayments(), pollDuePayments(), pollDuePayments()]);
    expect(calls.filter((address) => address === result.depositAddress).length).toBe(1);
  });

  it("doesn't show a customer's session to the merchant-facing session lookup before a quote", async () => {
    await expect(loadSession("pay_missing")).rejects.toMatchObject({ status: 404 });
  });
});

async function fund(amount: bigint, assetId = ASSETS.USDC.assetId) {
  await db().insert(schema.simBalances).values({ account: wallet, assetId, amount: amount.toString() }).onConflictDoUpdate({ target: [schema.simBalances.account, schema.simBalances.assetId], set: { amount: amount.toString() } });
}

async function destination(orgId: string, address = wallet) {
  const id = `dst_${randomBytes(8).toString("hex")}`;
  await db().insert(schema.destinations).values({ id, orgId, label: "Wallet", address });
  return id;
}

describe("payouts", () => {
  it("prepares a payload that passes the browser's check and sends once", async () => {
    await fund(100_000_000n);
    const { orgId, userId } = await merchantOrg();
    const destinationId = await destination(orgId);
    const prepared = await preparePayout({ orgId, userId, asset: "USDC", amountBase: 40_000_000n, receiveAsset: "USDC", destinationId });
    expect(checkTransferPayload(prepared.payload, { signer: wallet, receiver: (prepared.quote.quote as { depositAddress: string }).depositAddress, assetId: ASSETS.USDC.assetId, amount: "40000000" })).toBeNull();

    const signature = await merchant.signMessage({ message: prepared.payload });
    const sent = await submitPayout({ orgId, payoutId: prepared.id, signature, userId });
    expect(sent?.state).toBe("processing");
    expect((await provider().balances(wallet, [ASSETS.USDC.assetId]))[0]).toBe("60000000");

    // A second click returns the first result and doesn't move money again.
    const again = await submitPayout({ orgId, payoutId: prepared.id, signature, userId });
    expect(again?.id).toBe(prepared.id);
    expect((await provider().balances(wallet, [ASSETS.USDC.assetId]))[0]).toBe("60000000");

    const done = await applyPayoutStatus(prepared.id, status("SUCCESS", { amountOut: "39000000", destinationChainTxHashes: [{ hash: "0xabc", explorerUrl: "https://x" }] }));
    expect(done?.state).toBe("sent");
    expect(done?.completedAt).not.toBeNull();
  });

  it("sends under concurrent submissions exactly once", async () => {
    await fund(100_000_000n);
    const { orgId, userId } = await merchantOrg();
    const prepared = await preparePayout({ orgId, userId, asset: "USDC", amountBase: 10_000_000n, receiveAsset: "USDC", destinationId: await destination(orgId) });
    const signature = await merchant.signMessage({ message: prepared.payload });
    const submitIntent = vi.fn(async () => ({ intentHash: "h" }));
    setProviderForTests(hostile({ submitIntent }));
    await Promise.all(Array.from({ length: 4 }, () => submitPayout({ orgId, payoutId: prepared.id, signature, userId })));
    expect(submitIntent).toHaveBeenCalledTimes(1);
  });

  it("refuses more than is available, and counts holds and payouts in flight", async () => {
    await fund(100_000_000n);
    const { orgId, userId } = await merchantOrg({ holdDays: 3 });
    const destinationId = await destination(orgId);
    await expect(preparePayout({ orgId, userId, asset: "USDC", amountBase: 100_000_001n, receiveAsset: "USDC", destinationId })).rejects.toMatchObject({ code: "insufficient_available" });

    // A payment settled inside the refund window can't leave yet.
    const { result } = await session(orgId);
    await applyPaymentStatus(result.id, status("SUCCESS", { amountOut: "50000000" }));
    await expect(preparePayout({ orgId, userId, asset: "USDC", amountBase: 50_000_001n, receiveAsset: "USDC", destinationId })).rejects.toMatchObject({ code: "insufficient_available" });

    const first = await preparePayout({ orgId, userId, asset: "USDC", amountBase: 30_000_000n, receiveAsset: "USDC", destinationId });
    const second = await preparePayout({ orgId, userId, asset: "USDC", amountBase: 30_000_000n, receiveAsset: "USDC", destinationId });
    setProviderForTests(hostile({ submitIntent: async () => ({ intentHash: "h" }) }));
    await submitPayout({ orgId, payoutId: first.id, signature: await merchant.signMessage({ message: first.payload }), userId });
    // The first is in flight now, so the second no longer fits.
    await expect(submitPayout({ orgId, payoutId: second.id, signature: await merchant.signMessage({ message: second.payload }), userId })).rejects.toMatchObject({ code: "insufficient_available" });
  });

  it("refuses a signature from any wallet but the merchant's", async () => {
    await fund(100_000_000n);
    const { orgId, userId } = await merchantOrg();
    const prepared = await preparePayout({ orgId, userId, asset: "USDC", amountBase: 10_000_000n, receiveAsset: "USDC", destinationId: await destination(orgId) });
    const submitIntent = vi.fn();
    setProviderForTests(hostile({ submitIntent }));
    await expect(submitPayout({ orgId, payoutId: prepared.id, signature: await stranger.signMessage({ message: prepared.payload }), userId })).rejects.toMatchObject({ code: "signature_wrong_wallet" });
    await expect(submitPayout({ orgId, payoutId: prepared.id, signature: await merchant.signMessage({ message: "something else" }), userId })).rejects.toMatchObject({ code: "signature_wrong_wallet" });
    expect(submitIntent).not.toHaveBeenCalled();
  });

  it("refuses an intent from the provider that isn't the expected transfer", async () => {
    await fund(100_000_000n);
    const { orgId, userId } = await merchantOrg();
    const destinationId = await destination(orgId);
    const sim = new SimProvider();
    setProviderForTests(hostile({
      generateIntent: async (input) => {
        const generated = await sim.generateIntent(input);
        const parsed = JSON.parse(generated.intent.payload);
        parsed.intents.push({ intent: "add_public_key", public_key: "ed25519:attacker" });
        return { intent: { standard: "erc191", payload: JSON.stringify(parsed) } };
      },
    }));
    await expect(preparePayout({ orgId, userId, asset: "USDC", amountBase: 10_000_000n, receiveAsset: "USDC", destinationId })).rejects.toMatchObject({ code: "intent_mismatch" });
    expect((await db().select().from(schema.payouts).where(eq(schema.payouts.orgId, orgId))).length).toBe(0);
  });

  it("refuses an unsigned or wrongly signed destination, and accepts one the wallet signed", async () => {
    await fund(100_000_000n);
    const { orgId, userId } = await merchantOrg();
    const other = "0x000000000000000000000000000000000000dEaD";
    const unsigned = await destination(orgId, other);
    await expect(preparePayout({ orgId, userId, asset: "USDC", amountBase: 1_000_000n, receiveAsset: "USDC", destinationId: unsigned })).rejects.toMatchObject({ code: "destination_unconfirmed" });

    const message = issueChallenge("destination", orgId, other);
    await expect(addDestination({ orgId, userId, label: "Other", address: other })).rejects.toMatchObject({ code: "signature_required" });
    await expect(addDestination({ orgId, userId, label: "Other", address: other, message, signature: await stranger.signMessage({ message }) })).rejects.toMatchObject({ code: "signature_wrong_wallet" });
    const added = await addDestination({ orgId, userId, label: "Other", address: other, message, signature: await merchant.signMessage({ message }) });
    await expect(preparePayout({ orgId, userId, asset: "USDC", amountBase: 1_000_000n, receiveAsset: "USDC", destinationId: added.id })).resolves.toBeTruthy();
  });

  it("refuses a destination that can't hold the chosen asset", async () => {
    await fund(100_000_000n);
    const { orgId, userId } = await merchantOrg();
    await expect(preparePayout({ orgId, userId, asset: "USDC", amountBase: 1_000_000n, receiveAsset: "SOL", destinationId: await destination(orgId) })).rejects.toMatchObject({ code: "destination_chain_mismatch" });
  });

  it("can't reach another merchant's payout or destination", async () => {
    await fund(100_000_000n);
    const owner = await merchantOrg();
    const other = await merchantOrg();
    const prepared = await preparePayout({ orgId: owner.orgId, userId: owner.userId, asset: "USDC", amountBase: 1_000_000n, receiveAsset: "USDC", destinationId: await destination(owner.orgId) });
    await expect(submitPayout({ orgId: other.orgId, payoutId: prepared.id, signature: await merchant.signMessage({ message: prepared.payload }), userId: other.userId })).rejects.toMatchObject({ status: 404 });
    await expect(preparePayout({ orgId: other.orgId, userId: other.userId, asset: "USDC", amountBase: 1_000_000n, receiveAsset: "USDC", destinationId: await destination(owner.orgId) })).rejects.toMatchObject({ code: "destination_not_found" });
  });

  it("marks a refused send failed, and keeps an unknown outcome reserved", async () => {
    await fund(100_000_000n);
    const { orgId, userId } = await merchantOrg();
    const destinationId = await destination(orgId);
    const refused = await preparePayout({ orgId, userId, asset: "USDC", amountBase: 1_000_000n, receiveAsset: "USDC", destinationId });
    setProviderForTests(hostile({ submitIntent: async () => { throw new ProviderRejected(400, "nope"); } }));
    expect((await submitPayout({ orgId, payoutId: refused.id, signature: await merchant.signMessage({ message: refused.payload }), userId }))?.state).toBe("failed");

    setProviderForTests(null);
    const unknown = await preparePayout({ orgId, userId, asset: "USDC", amountBase: 1_000_000n, receiveAsset: "USDC", destinationId });
    setProviderForTests(hostile({ submitIntent: async () => { throw new ProviderUnavailable("timeout"); } }));
    const row = await submitPayout({ orgId, payoutId: unknown.id, signature: await merchant.signMessage({ message: unknown.payload }), userId });
    expect(row?.state).toBe("submitting");
    expect(row?.nextPollAt).not.toBeNull();
    setProviderForTests(null);
    await expect(preparePayout({ orgId, userId, asset: "USDC", amountBase: 99_500_000n, receiveAsset: "USDC", destinationId })).rejects.toMatchObject({ code: "insufficient_available" });
  });

  it("expires an unsigned payout", async () => {
    await fund(100_000_000n);
    const { orgId, userId } = await merchantOrg();
    const prepared = await preparePayout({ orgId, userId, asset: "USDC", amountBase: 1_000_000n, receiveAsset: "USDC", destinationId: await destination(orgId) });
    await db().update(schema.payouts).set({ signExpiresAt: new Date(Date.now() - 1000) }).where(eq(schema.payouts.id, prepared.id));
    await expect(submitPayout({ orgId, payoutId: prepared.id, signature: await merchant.signMessage({ message: prepared.payload }), userId })).rejects.toMatchObject({ code: "payout_expired" });
  });
});

describe("refunds", () => {
  async function settled(orgOverrides = {}) {
    const fixture = await merchantOrg(orgOverrides);
    const { result } = await session(fixture.orgId);
    await applyPaymentStatus(result.id, status("SUCCESS", { amountOut: "50000000" }));
    return { ...fixture, paymentId: result.id };
  }

  it("pays the customer's own wallet, in their asset, and completes the payment", async () => {
    await fund(100_000_000n);
    const { orgId, userId, paymentId } = await settled();
    const prepared = await prepareRefund({ orgId, paymentId, userId });
    if (prepared.kind !== "intent") throw new Error("expected an intent refund");
    expect(prepared.recipient).toBe(CUSTOMER);
    expect(prepared.payAsset).toBe("ETH");
    const row = await submitRefund({ orgId, refundId: prepared.id, signature: await merchant.signMessage({ message: prepared.payload }), userId });
    expect(row?.state).toBe("processing");
    expect((await paymentById(paymentId)).state).toBe("refund_pending");
    await applyRefundStatus(prepared.id, status("SUCCESS"));
    const payment = await paymentById(paymentId);
    expect(payment.state).toBe("refunded");
    expect(payment.refundedAt).not.toBeNull();
    expect(payment.refundedBase).toBe("50000000");
  });

  it("supports partial refunds, and never more than was received", async () => {
    await fund(100_000_000n);
    const { orgId, userId, paymentId } = await settled();
    await expect(prepareRefund({ orgId, paymentId, amountBase: "50000001", userId })).rejects.toMatchObject({ code: "refund_too_large" });

    const first = await prepareRefund({ orgId, paymentId, amountBase: "30000000", userId });
    if (first.kind !== "intent") throw new Error("expected an intent refund");
    await submitRefund({ orgId, refundId: first.id, signature: await merchant.signMessage({ message: first.payload }), userId });
    await applyRefundStatus(first.id, status("SUCCESS"));
    const partly = await paymentById(paymentId);
    expect(partly.state).toBe("settled");
    expect(partly.refundedBase).toBe("30000000");

    await expect(prepareRefund({ orgId, paymentId, amountBase: "20000001", userId })).rejects.toMatchObject({ code: "refund_too_large" });
    const rest = await prepareRefund({ orgId, paymentId, userId });
    expect(rest.amountBase).toBe("20000000");
  });

  it("allows one refund in flight at a time, and returns the payment to settled if it fails", async () => {
    await fund(100_000_000n);
    const { orgId, userId, paymentId } = await settled();
    const first = await prepareRefund({ orgId, paymentId, amountBase: "10000000", userId });
    if (first.kind !== "intent") throw new Error("expected an intent refund");
    await submitRefund({ orgId, refundId: first.id, signature: await merchant.signMessage({ message: first.payload }), userId });
    await expect(prepareRefund({ orgId, paymentId, amountBase: "1000000", userId })).rejects.toMatchObject({ code: "not_refundable" });
    await applyRefundStatus(first.id, status("FAILED"));
    expect((await paymentById(paymentId)).state).toBe("settled");
    expect((await paymentById(paymentId)).refundedBase).toBe("0");
  });

  it("refuses an unsettled payment", async () => {
    const { orgId, userId } = await merchantOrg();
    const { result } = await session(orgId);
    await expect(prepareRefund({ orgId, paymentId: result.id, userId })).rejects.toMatchObject({ code: "not_refundable" });
  });

  it("refuses when the balance can't cover it", async () => {
    await fund(1_000_000n);
    const { orgId, userId, paymentId } = await settled();
    await expect(prepareRefund({ orgId, paymentId, userId })).rejects.toMatchObject({ code: "insufficient_available" });
  });

  it("routes a direct-mode refund through a deposit the merchant sends, to the customer's chain", async () => {
    const { orgId, userId, paymentId } = await settled({ settlementMode: "direct" });
    const prepared = await prepareRefund({ orgId, paymentId, userId });
    if (prepared.kind !== "route") throw new Error("expected a route refund");
    expect(prepared.depositAddress).toMatch(/^sim_/);
    expect(prepared.chain).toBe("Base");
    expect(prepared.recipient).toBe(CUSTOMER);
    // Nothing is pending until the merchant's money is seen.
    expect((await paymentById(paymentId)).state).toBe("settled");
    await applyRefundStatus(prepared.id, status("PROCESSING"));
    expect((await paymentById(paymentId)).state).toBe("refund_pending");
    await applyRefundStatus(prepared.id, status("SUCCESS"));
    expect((await paymentById(paymentId)).state).toBe("refunded");
  });

  it("counts a refund only once if a status repeats", async () => {
    await fund(100_000_000n);
    const { orgId, userId, paymentId } = await settled();
    const prepared = await prepareRefund({ orgId, paymentId, amountBase: "10000000", userId });
    if (prepared.kind !== "intent") throw new Error("expected an intent refund");
    await submitRefund({ orgId, refundId: prepared.id, signature: await merchant.signMessage({ message: prepared.payload }), userId });
    await applyRefundStatus(prepared.id, status("SUCCESS"));
    await applyRefundStatus(prepared.id, status("SUCCESS"));
    expect((await paymentById(paymentId)).refundedBase).toBe("10000000");
  });
});

describe("settlement wallet", () => {
  const sign = async (account: typeof merchant, orgId: string, address: string) => {
    const message = issueChallenge("settlement", orgId, address);
    return { message, signature: await account.signMessage({ message }) };
  };

  it("connects with the new wallet's signature", async () => {
    const { orgId, userId } = await createOrg();
    const { message, signature } = await sign(merchant, orgId, wallet);
    const org = await setSettlementWallet({ orgId, userId, wallet, message, newSignature: signature });
    expect(org.walletAddress).toBe(wallet);
    expect((await db().select().from(schema.destinations).where(eq(schema.destinations.orgId, orgId)))[0].address).toBe(wallet);
  });

  it("refuses a signature from another wallet, a stale message, and another workspace's message", async () => {
    const { orgId, userId } = await createOrg();
    const good = await sign(merchant, orgId, wallet);
    const fromStranger = await sign(stranger, orgId, wallet);
    await expect(setSettlementWallet({ orgId, userId, wallet, message: fromStranger.message, newSignature: fromStranger.signature })).rejects.toMatchObject({ code: "signature_wrong_wallet" });
    const old = issueChallenge("settlement", orgId, wallet, new Date(Date.now() - 3_600_000));
    await expect(setSettlementWallet({ orgId, userId, wallet, message: old, newSignature: await merchant.signMessage({ message: old }) })).rejects.toMatchObject({ code: "challenge_expired" });
    const other = await createOrg();
    await expect(setSettlementWallet({ orgId: other.orgId, userId: other.userId, wallet, message: good.message, newSignature: good.signature })).rejects.toMatchObject({ code: "challenge_invalid" });
    const forged = good.message.replace(/Code: .*/, "Code: 00000000000000000000000000000000");
    await expect(setSettlementWallet({ orgId, userId, wallet, message: forged, newSignature: await merchant.signMessage({ message: forged }) })).rejects.toMatchObject({ code: "challenge_invalid" });
  });

  it("can't be replaced without the current wallet, however much time passes", async () => {
    await fund(0n);
    const { orgId, userId } = await merchantOrg();
    const attacker = stranger.address.toLowerCase();
    const { message, signature } = await sign(stranger, orgId, attacker);
    await expect(setSettlementWallet({ orgId, userId, wallet: attacker, message, newSignature: signature })).rejects.toMatchObject({ code: "current_signature_required" });
    await expect(setSettlementWallet({ orgId, userId, wallet: attacker, message, newSignature: signature, currentSignature: signature })).rejects.toMatchObject({ code: "signature_wrong_wallet" });
    const org = await db().select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
    expect(org[0].walletAddress).toBe(wallet);
  });

  it("replaces with both signatures, but not while the old wallet holds a balance", async () => {
    await fund(5n);
    const { orgId, userId } = await merchantOrg();
    const next = stranger.address.toLowerCase();
    const { message, signature } = await sign(stranger, orgId, next);
    const current = await merchant.signMessage({ message });
    await expect(setSettlementWallet({ orgId, userId, wallet: next, message, newSignature: signature, currentSignature: current })).rejects.toMatchObject({ code: "balance_not_empty" });
    await fund(0n);
    const org = await setSettlementWallet({ orgId, userId, wallet: next, message, newSignature: signature, currentSignature: current });
    expect(org.walletAddress).toBe(next);
  });

  it("refuses a sanctioned wallet", async () => {
    const { orgId, userId } = await createOrg();
    await db().insert(schema.screenedAddresses).values({ address: wallet, source: "test" });
    const { message, signature } = await sign(merchant, orgId, wallet);
    await expect(setSettlementWallet({ orgId, userId, wallet, message, newSignature: signature })).rejects.toMatchObject({ code: "not_permitted" });
    await db().delete(schema.screenedAddresses);
  });
});
