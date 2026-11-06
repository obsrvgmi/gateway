import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ASSETS } from "@/lib/assets";
import { db, schema } from "@/server/db";
import { resetEnv } from "@/server/env";
import { newId } from "@/server/ids";
import { createSession } from "@/server/payments/checkout";
import { assertAboveDestinationMinimum } from "@/server/payments/guards";
import { applyPayoutStatus, preparePayout, submitPayout } from "@/server/payments/payouts";
import { provider, setProviderForTests } from "@/server/payments/provider";
import { signSimQuote, SimProvider } from "@/server/payments/provider/sim";
import type { QuoteRequest, QuoteResponse, SwapProvider } from "@/server/payments/provider/types";
import { loadSource } from "@/server/payments/source";
import { issueChallenge } from "@/server/payments/wallet";
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
    await applyPayoutStatus(prepared.id, { status: "SUCCESS", updatedAt: new Date().toISOString(), swapDetails: { originChainTxHashes: [], destinationChainTxHashes: [] } });
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
