import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ASSETS } from "@/lib/assets";
import { db, schema } from "@/server/db";
import { assertQuoteReasonable, createSession } from "@/server/payments/checkout";
import { assertFreshPrice, assertRefundFeeReasonable, customerPayBy, requestedDeadlineMs } from "@/server/payments/guards";
import { provider, setProviderForTests } from "@/server/payments/provider";
import type { QuoteResponse, StatusResponse, SwapProvider, TokenInfo } from "@/server/payments/provider/types";
import { signSimQuote, SimProvider } from "@/server/payments/provider/sim";
import { applyPaymentStatus } from "@/server/payments/poller";
import { applyRefundStatus, prepareRefund, recordRefundDeposit } from "@/server/payments/refunds";
import { loadSource, payOptions } from "@/server/payments/source";
import { resetTokenCache } from "@/server/payments/tokens";
import { setSettlementWallet, issueChallenge } from "@/server/payments/wallet";
import { newId } from "@/server/ids";
import { createLink, createOrg, freshDatabase, paymentById, WALLET_KEY } from "./support/db";

const merchant = privateKeyToAccount(WALLET_KEY);
const wallet = merchant.address.toLowerCase();
const next = privateKeyToAccount("0x5de4111afa1a4b94908f83103eb1f1706367c2e68ea870594951c6ec0c7c1ac5");
const CUSTOMER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const key = () => randomBytes(8).toString("hex");
const status = (name: StatusResponse["status"], details: Partial<StatusResponse["swapDetails"]> = {}): StatusResponse => ({ status: name, updatedAt: new Date().toISOString(), swapDetails: { originChainTxHashes: [], destinationChainTxHashes: [], ...details } });

let close: () => Promise<void>;
beforeAll(async () => {
  ({ close } = await freshDatabase());
});
afterAll(async () => close());
afterEach(() => {
  setProviderForTests(null);
  resetTokenCache();
});

function hostile(overrides: Partial<SwapProvider>): SwapProvider {
  const sim = provider();
  return Object.assign(Object.create(Object.getPrototypeOf(sim)), sim, overrides, { kind: "sim", quoteKey: sim.quoteKey }) as SwapProvider;
}

const quote = (overrides: Partial<QuoteResponse["quote"]>): QuoteResponse["quote"] => ({ amountIn: "1000000", amountInFormatted: "1", amountInUsd: "1", minAmountIn: "1", amountOut: "1", amountOutFormatted: "1", amountOutUsd: "1", minAmountOut: "1", timeEstimate: 1, ...overrides });

describe("a quote that costs the customer too much", () => {
  it("is refused above the premium limit", () => {
    expect(() => assertQuoteReasonable(100, quote({ amountInUsd: "108.5", amountOutUsd: "100" }))).toThrow();
    expect(() => assertQuoteReasonable(100, quote({ amountInUsd: "not-a-number", amountOutUsd: "100" }))).toThrow();
    expect(() => assertQuoteReasonable(100, quote({ amountInUsd: "101.3", amountOutUsd: "99.9" }))).not.toThrow();
  });
});

describe("a quote that would leave the merchant short", () => {
  it("is refused when the customer would pay far below the price, a sign a price is wrong", () => {
    expect(() => assertQuoteReasonable(100, quote({ amountInUsd: "1", amountOutUsd: "100" }))).toThrow(/looks wrong/);
    expect(() => assertQuoteReasonable(100, quote({ amountInUsd: "96", amountOutUsd: "100" }))).toThrow(/looks wrong/);
  });

  it("is refused when it would deliver far below the price", () => {
    expect(() => assertQuoteReasonable(100, quote({ amountInUsd: "101", amountOutUsd: "1" }))).toThrow(/looks wrong/);
    expect(() => assertQuoteReasonable(100, quote({ amountInUsd: "101", amountOutUsd: "x" }))).toThrow(/looks wrong/);
  });
});

describe("the refund fee", () => {
  it("can't exceed a sane share of the payment", () => {
    expect(() => assertRefundFeeReasonable(quote({ amountIn: "1000", refundFee: "60" }))).toThrow(/too small/);
    expect(() => assertRefundFeeReasonable(quote({ amountIn: "1000", refundFee: "40" }))).not.toThrow();
    expect(() => assertRefundFeeReasonable(quote({ amountIn: "1000" }))).not.toThrow();
  });

  it("refuses at checkout before an address is issued", async () => {
    const { orgId } = await createOrg({ walletAddress: wallet });
    const source = await loadSource(await createLink(orgId));
    const sim = new SimProvider();
    setProviderForTests(hostile({ quote: async (request) => { const response = await sim.quote(request); response.quote.refundFee = response.quote.amountIn; return signSimQuote(response); } }));
    await expect(createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: key() })).rejects.toMatchObject({ code: "amount_below_network_fees" });
  });
});

describe("the customer's countdown", () => {
  const NOW = Date.UTC(2026, 10, 6);
  const HOUR = 3_600_000;

  it("always ends before the provider's deadline, by enough to be mined", () => {
    const threeDays = NOW + 72 * HOUR;
    expect(customerPayBy("eth", threeDays, NOW)?.getTime()).toBe(NOW + 30 * 60_000);
    expect(customerPayBy("btc", threeDays, NOW)?.getTime()).toBe(NOW + HOUR);
    expect(customerPayBy("eth", NOW + 20 * 60_000 + 6 * 60_000, NOW)?.getTime()).toBe(NOW + 11 * 60_000);
  });

  it("gives Bitcoin room for its slow confirmations", () => {
    expect(customerPayBy("btc", NOW + 2 * HOUR, NOW)?.getTime()).toBe(NOW + 30 * 60_000);
    expect(requestedDeadlineMs("btc")).toBeGreaterThan(requestedDeadlineMs("eth"));
  });

  it("refuses when there's no safe window at all", () => {
    expect(customerPayBy("eth", NOW + 15 * 60_000, NOW)).toBeNull();
    expect(customerPayBy("btc", NOW + 90 * 60_000, NOW)).toBeNull();
  });

  it("refuses to issue an address the customer can't safely pay", async () => {
    const { orgId } = await createOrg({ walletAddress: wallet });
    const source = await loadSource(await createLink(orgId));
    const sim = new SimProvider();
    setProviderForTests(hostile({ quote: async (request) => {
      // A signed response whose deadline leaves only minutes, as a provider could return.
      vi.setSystemTime(new Date(Date.now() - 3 * 86_400_000 + 10 * 60_000));
      const response = await sim.quote(request);
      vi.useRealTimers();
      return response;
    } }));
    vi.useFakeTimers({ toFake: ["Date"] });
    await expect(createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: key() })).rejects.toBeTruthy();
    vi.useRealTimers();
    const [row] = await db().select().from(schema.payments).where(eq(schema.payments.sourceId, source.id));
    expect(row.state).toBe("quote_failed");
    expect(row.nextPollAt).toBeNull();
  });
});

describe("pricing a non-stable asset", () => {
  const token = (overrides: Partial<TokenInfo>): TokenInfo => ({ assetId: ASSETS.ETH.assetId, decimals: 18, blockchain: "eth", symbol: "ETH", price: 3000, priceUpdatedAt: new Date().toISOString(), ...overrides });

  it("refuses a stale or missing price", () => {
    expect(() => assertFreshPrice("ETH", token({ priceUpdatedAt: new Date(Date.now() - 6 * 60_000).toISOString() }))).toThrow();
    expect(() => assertFreshPrice("ETH", token({ price: null }))).toThrow();
    expect(() => assertFreshPrice("ETH", token({ priceUpdatedAt: null }))).toThrow();
    expect(() => assertFreshPrice("ETH", undefined)).toThrow();
    expect(() => assertFreshPrice("ETH", token({}))).not.toThrow();
  });

  it("doesn't need a price for a stablecoin", () => {
    expect(() => assertFreshPrice("USDC", undefined)).not.toThrow();
  });

  it("stops a checkout before any row is written", async () => {
    const { orgId } = await createOrg({ walletAddress: wallet });
    const source = await loadSource(await createLink(orgId, { receiveAsset: "ETH" }));
    setProviderForTests(hostile({ tokens: async () => [token({ priceUpdatedAt: new Date(0).toISOString() })] }));
    resetTokenCache();
    await expect(createSession(source, { payAsset: "ARB", refundAddress: CUSTOMER, idempotencyKey: key() })).rejects.toMatchObject({ code: "price_stale" });
    expect((await db().select().from(schema.payments).where(eq(schema.payments.sourceId, source.id))).length).toBe(0);
  });
});

describe("routes whose quotes can't be verified", () => {
  /** The provider's identity is what decides this, so the fake claims to be the real one. */
  const asLive = () => setProviderForTests(Object.assign(hostile({}), { kind: "oneclick" as const }));

  it("are closed with real money, before a quote is requested, even if the customer asks directly", async () => {
    const { orgId } = await createOrg({ walletAddress: wallet });
    const source = await loadSource(await createLink(orgId));
    const quoteCalled = vi.fn();
    setProviderForTests(Object.assign(hostile({ quote: quoteCalled as never }), { kind: "oneclick" as const }));
    await expect(createSession(source, { payAsset: "BTC", refundAddress: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", idempotencyKey: key() })).rejects.toMatchObject({ code: "route_unverifiable" });
    expect(quoteCalled).not.toHaveBeenCalled();
    expect((await db().select().from(schema.payments).where(eq(schema.payments.sourceId, source.id))).length).toBe(0);
  });

  it("show as unavailable at checkout with real money, while other routes stay open", async () => {
    const { orgId } = await createOrg({ walletAddress: wallet });
    const source = await loadSource(await createLink(orgId));
    asLive();
    const options = await payOptions(source);
    expect(options.find((option) => option.symbol === "BTC")?.paused).toBe(true);
    expect(options.find((option) => option.symbol === "ETH")?.paused).toBe(false);
  });

  it("stay open in test mode, which signs its own quotes", async () => {
    const { orgId } = await createOrg({ walletAddress: wallet });
    const source = await loadSource(await createLink(orgId));
    expect((await payOptions(source)).find((option) => option.symbol === "BTC")?.paused).toBe(false);
  });
});

describe("what a widget accepts", () => {
  it("is enforced by the server, not by the page", async () => {
    const { orgId } = await createOrg({ walletAddress: wallet });
    const id = newId("wgt_");
    await db().insert(schema.widgets).values({ id, orgId, name: "Shop", accent: "#00EC97", amountUsd: "50.00", receiveAsset: "USDC", acceptedAssets: ["USDC"], presets: [], success: { mode: "receipt", message: "", url: "" } });
    const source = await loadSource(id);
    await expect(createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: key() })).rejects.toMatchObject({ code: "asset_not_accepted" });
    await expect(createSession(source, { payAsset: "USDC", refundAddress: CUSTOMER, idempotencyKey: key() })).resolves.toBeTruthy();
  });
});

describe("across a wallet change", () => {
  it("asks the wallet that holds the funds to sign a refund, not the new one", async () => {
    const { orgId, userId } = await createOrg({ walletAddress: wallet });
    const source = await loadSource(await createLink(orgId));
    const session = await createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: key() });
    await applyPaymentStatus(session.id, status("SUCCESS", { amountOut: "50000000" }));
    await db().insert(schema.simBalances).values({ account: wallet, assetId: ASSETS.USDC.assetId, amount: "50000000" }).onConflictDoUpdate({ target: [schema.simBalances.account, schema.simBalances.assetId], set: { amount: "50000000" } });
    await db().update(schema.organizations).set({ walletAddress: next.address.toLowerCase() }).where(eq(schema.organizations.id, orgId));
    const prepared = await prepareRefund({ orgId, paymentId: session.id, userId });
    if (prepared.kind !== "intent") throw new Error("expected an intent refund");
    expect(prepared.signer).toBe(wallet);
  });

  it("tells the merchant when a payment lands in their previous wallet", async () => {
    const { orgId } = await createOrg({ walletAddress: wallet });
    const source = await loadSource(await createLink(orgId));
    const session = await createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: key() });
    await db().update(schema.organizations).set({ walletAddress: next.address.toLowerCase() }).where(eq(schema.organizations.id, orgId));
    await applyPaymentStatus(session.id, status("SUCCESS", { amountOut: "50000000" }));
    expect((await db().select().from(schema.outbox).where(eq(schema.outbox.orgId, orgId))).map((event) => event.type)).toContain("alert.previous_wallet");
  });

  it("ends the countdown on open checkouts, which would still pay the old wallet", async () => {
    const { orgId, userId } = await createOrg({ walletAddress: wallet });
    const source = await loadSource(await createLink(orgId));
    const session = await createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: key() });
    await db().insert(schema.simBalances).values({ account: wallet, assetId: ASSETS.USDC.assetId, amount: "0" }).onConflictDoUpdate({ target: [schema.simBalances.account, schema.simBalances.assetId], set: { amount: "0" } });
    const target = next.address.toLowerCase();
    const message = issueChallenge("settlement", orgId, target);
    await setSettlementWallet({ orgId, userId, wallet: target, message, newSignature: await next.signMessage({ message }), currentSignature: await merchant.signMessage({ message }) });
    const row = await applyPaymentStatus(session.id, status("PENDING_DEPOSIT"));
    expect(row?.state).toBe("expired");
    expect(row?.nextPollAt).not.toBeNull();
  });
});

describe("a wallet can't change with money on its way", () => {
  it("waits for a payment in flight to the current wallet", async () => {
    const { orgId, userId } = await createOrg({ walletAddress: wallet });
    const source = await loadSource(await createLink(orgId));
    const session = await createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: key() });
    await applyPaymentStatus(session.id, status("KNOWN_DEPOSIT_TX"));
    const target = next.address.toLowerCase();
    const message = issueChallenge("settlement", orgId, target);
    await expect(setSettlementWallet({ orgId, userId, wallet: target, message, newSignature: await next.signMessage({ message }), currentSignature: await merchant.signMessage({ message }) })).rejects.toMatchObject({ code: "payments_in_flight" });
  });
});

describe("a direct-mode refund nobody funded", () => {
  async function settledDirect() {
    const fixture = await createOrg({ walletAddress: wallet, settlementMode: "direct" });
    const source = await loadSource(await createLink(fixture.orgId));
    const session = await createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: key() });
    await applyPaymentStatus(session.id, status("SUCCESS", { amountOut: "50000000" }));
    return { ...fixture, paymentId: session.id };
  }
  const refundById = async (id: string) => (await db().select().from(schema.refunds).where(eq(schema.refunds.id, id)))[0];

  it("gives back the same address when asked again, never a second one to pay", async () => {
    const { orgId, userId, paymentId } = await settledDirect();
    const first = await prepareRefund({ orgId, paymentId, userId });
    const again = await prepareRefund({ orgId, paymentId, userId });
    expect(again.id).toBe(first.id);
    if (first.kind !== "route" || again.kind !== "route") throw new Error("expected route refunds");
    expect(again.depositAddress).toBe(first.depositAddress);
  });

  it("can't be replaced for a different amount right away, but can after a while", async () => {
    const { orgId, userId, paymentId } = await settledDirect();
    const first = await prepareRefund({ orgId, paymentId, userId });
    await expect(prepareRefund({ orgId, paymentId, amountBase: "10000000", userId })).rejects.toMatchObject({ code: "refund_open" });
    await db().update(schema.refunds).set({ createdAt: new Date(Date.now() - 3_600_000) }).where(eq(schema.refunds.id, first.id));
    const second = await prepareRefund({ orgId, paymentId, amountBase: "10000000", userId });
    expect(second.id).not.toBe(first.id);
    expect((await refundById(first.id)).state).toBe("abandoned");
    expect((await refundById(first.id)).nextPollAt).not.toBeNull();
  });

  it("still counts money that reaches a replaced address late", async () => {
    const { orgId, userId, paymentId } = await settledDirect();
    const first = await prepareRefund({ orgId, paymentId, amountBase: "20000000", userId });
    await db().update(schema.refunds).set({ state: "abandoned" }).where(eq(schema.refunds.id, first.id));
    await applyRefundStatus(first.id, status("PROCESSING"));
    await applyRefundStatus(first.id, status("SUCCESS"));
    expect((await paymentById(paymentId)).refundedBase).toBe("20000000");
  });

  it("doesn't offer an address close to its deadline again, where funds may be lost", async () => {
    const { orgId, userId, paymentId } = await settledDirect();
    const first = await prepareRefund({ orgId, paymentId, userId });
    const stored = await refundById(first.id);
    const quote = stored.quote as QuoteResponse;
    quote.quote.deadline = new Date(Date.now() + 3_600_000).toISOString();
    await db().update(schema.refunds).set({ quote }).where(eq(schema.refunds.id, first.id));
    const second = await prepareRefund({ orgId, paymentId, userId });
    expect(second.id).not.toBe(first.id);
    expect((await refundById(first.id)).state).toBe("abandoned");
  });

  it("can't open two under overlapping requests", async () => {
    const { orgId, userId, paymentId } = await settledDirect();
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => prepareRefund({ orgId, paymentId, userId })));
    const opened = await db().select().from(schema.refunds).where(eq(schema.refunds.paymentId, paymentId));
    expect(opened.filter((row) => row.state === "awaiting_deposit").length).toBe(1);
    const ids = new Set(results.flatMap((result) => (result.status === "fulfilled" ? [result.value.id] : [])));
    expect(ids.size).toBe(1);
    expect(ids.has(opened.find((row) => row.state === "awaiting_deposit")?.id as string)).toBe(true);
  });

  it("remembers the merchant sent it, and never offers a second send, or replaces it", async () => {
    const { orgId, userId, paymentId } = await settledDirect();
    const first = await prepareRefund({ orgId, paymentId, userId });
    await recordRefundDeposit({ orgId, refundId: first.id, txHash: "0xmerchant" });
    const again = await prepareRefund({ orgId, paymentId, userId });
    if (again.kind !== "route") throw new Error("expected a route refund");
    expect(again.id).toBe(first.id);
    expect(again.depositTxHash).toBe("0xmerchant");
    await db().update(schema.refunds).set({ createdAt: new Date(Date.now() - 3_600_000) }).where(eq(schema.refunds.id, first.id));
    await expect(prepareRefund({ orgId, paymentId, amountBase: "1000000", userId })).rejects.toMatchObject({ code: "refund_open" });
  });

  it("can't record a deposit on another workspace's refund", async () => {
    const { orgId, userId, paymentId } = await settledDirect();
    const first = await prepareRefund({ orgId, paymentId, userId });
    const other = await createOrg();
    await expect(recordRefundDeposit({ orgId: other.orgId, refundId: first.id, txHash: "0xother" })).rejects.toMatchObject({ status: 404 });
  });

  it("closes itself well after the provider's deadline, and not before", async () => {
    const { orgId, userId, paymentId } = await settledDirect();
    const first = await prepareRefund({ orgId, paymentId, userId });
    await applyRefundStatus(first.id, status("PENDING_DEPOSIT"));
    expect((await refundById(first.id)).state).toBe("awaiting_deposit");
    const later = new Date(Date.now() + 11 * 86_400_000);
    await applyRefundStatus(first.id, status("PENDING_DEPOSIT"), later);
    const closed = await refundById(first.id);
    expect(closed.state).toBe("expired");
    expect(closed.nextPollAt).toBeNull();
  });
});
