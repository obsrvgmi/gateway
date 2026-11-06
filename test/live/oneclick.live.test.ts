import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ASSETS, ASSET_SYMBOLS } from "@/lib/assets";
import { checkTransferPayload, verifyQuoteSignature, type SignedQuote } from "@/lib/intents";
import { resetEnv } from "@/server/env";
import { createSession, previewQuote } from "@/server/payments/checkout";
import { prepareIntent } from "@/server/payments/intent-flow";
import { OneClickProvider } from "@/server/payments/provider/oneclick";
import { setProviderForTests } from "@/server/payments/provider";
import { pollDuePayments } from "@/server/payments/poller";
import { loadSource } from "@/server/payments/source";
import { resetTokenCache } from "@/server/payments/tokens";
import { createLink, createOrg, freshDatabase, paymentById } from "../support/db";

/**
 * Runs our real guards against the real 1Click API and NEAR RPC: `npm run test:live`.
 * Issues unpaid deposit addresses that nobody is told about. Sends no funds.
 */
const ACCOUNT = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
const CHECKSUMMED = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const real = new OneClickProvider({ baseUrl: "https://1click.chaindefuser.com", nearRpcUrl: "https://rpc.mainnet.near.org" });

let close: () => Promise<void>;
beforeAll(async () => {
  ({ close } = await freshDatabase());
  setProviderForTests(real);
  resetTokenCache();
});
afterAll(async () => {
  setProviderForTests(null);
  await close();
});

describe("the catalog matches the provider", () => {
  it("lists every asset we offer, with the same chain and decimals", async () => {
    const tokens = await real.tokens();
    for (const symbol of ASSET_SYMBOLS) {
      const asset = ASSETS[symbol];
      const token = tokens.find((item) => item.assetId === asset.assetId);
      expect(token, `${symbol} is on the provider`).toBeTruthy();
      expect(token?.blockchain).toBe(asset.blockchain);
      expect(token?.decimals).toBe(asset.tokenDecimals);
      expect(token?.price, `${symbol} has a price`).toBeGreaterThan(0);
    }
  });
});

describe("a checkout, through every guard", () => {
  it("previews a real route", async () => {
    const { orgId } = await createOrg({ walletAddress: ACCOUNT });
    const source = await loadSource(await createLink(orgId));
    const preview = await previewQuote(source, { payAsset: "ETH" });
    expect(Number(preview.payAmount)).toBeGreaterThan(0);
    expect(preview.receiveAmount).toBe("50");
    expect(preview.feeUsd).toBeGreaterThan(0);
  });

  // Over NEAR's $100 Tron and $1,000 BNB Chain minimums, so those routes get tested too.
  it.each(["SOL", "ARB", "NEAR", "USDC", "USDT", "BNB"] as const)("previews from %s with a verified signature", async (payAsset) => {
    process.env.MINIMUMS_EXEMPT_INTENTS_RECIPIENT = "true";
    resetEnv();
    const { orgId } = await createOrg({ walletAddress: ACCOUNT });
    const source = await loadSource(await createLink(orgId, { amountUsd: "1500.00" }));
    await expect(previewQuote(source, { payAsset })).resolves.toBeTruthy();
    delete process.env.MINIMUMS_EXEMPT_INTENTS_RECIPIENT;
    resetEnv();
  });

  it.each(["NEAR", "USDT", "ETH"] as const)("pays out in %s", async (receiveAsset) => {
    const { orgId } = await createOrg({ walletAddress: ACCOUNT });
    const source = await loadSource(await createLink(orgId, { receiveAsset }));
    await expect(previewQuote(source, { payAsset: receiveAsset === "ETH" ? "SOL" : "ETH" })).resolves.toBeTruthy();
  });

  it("keeps Bitcoin closed, because its quotes don't verify", async () => {
    const { orgId } = await createOrg({ walletAddress: ACCOUNT });
    const source = await loadSource(await createLink(orgId));
    await expect(previewQuote(source, { payAsset: "BTC" })).rejects.toMatchObject({ code: "route_unverifiable" });
  });

  it("still finds Bitcoin's signature broken. If this fails, NEAR fixed it: reopen the route", async () => {
    const response = await real.quote({ dry: true, swapType: "EXACT_OUTPUT", slippageTolerance: 100, originAsset: ASSETS.BTC.assetId, depositType: "ORIGIN_CHAIN", destinationAsset: ASSETS.USDC.assetId, amount: "50000000", refundTo: "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", refundType: "ORIGIN_CHAIN", recipient: ACCOUNT, recipientType: "INTENTS", deadline: new Date(Date.now() + 14_400_000).toISOString() });
    expect(verifyQuoteSignature(response as unknown as SignedQuote)).toBe(false);
  });

  it("issues a real, signed deposit address, and the poller reads it", async () => {
    const { orgId } = await createOrg({ walletAddress: ACCOUNT });
    const source = await loadSource(await createLink(orgId));
    const session = await createSession(source, { payAsset: "ETH", refundAddress: CHECKSUMMED, idempotencyKey: randomBytes(8).toString("hex") });
    expect(session.state).toBe("awaiting_deposit");
    expect(session.depositAddress).toMatch(/^0x/);
    expect(new Date(session.payBy as string).getTime()).toBeLessThan(new Date(session.deadline as string).getTime());

    const { db, schema } = await import("@/server/db");
    const { eq } = await import("drizzle-orm");
    await db().update(schema.payments).set({ nextPollAt: new Date(Date.now() - 1000) }).where(eq(schema.payments.id, session.id));
    await pollDuePayments();
    const row = await paymentById(session.id);
    expect(row.providerStatus).toBe("PENDING_DEPOSIT");
    expect(row.pollFailures).toBe(0);
    expect(row.state).toBe("awaiting_deposit");
  });

  it("doesn't take a bad address past the provider", async () => {
    const { orgId } = await createOrg({ walletAddress: ACCOUNT });
    const source = await loadSource(await createLink(orgId));
    await expect(createSession(source, { payAsset: "ETH", refundAddress: "0x000000000000000000000000000000000000dEaD", idempotencyKey: randomBytes(8).toString("hex") })).rejects.toBeTruthy();
  });
});

describe("a payout, up to the signature", () => {
  it("gets a real intent that passes the check the browser repeats", async () => {
    const prepared = await prepareIntent({ account: ACCOUNT, asset: "USDC", amountBase: 50_000_000n, receiveAsset: "USDC", recipient: CHECKSUMMED });
    expect(checkTransferPayload(prepared.payload, { signer: ACCOUNT, receiver: prepared.depositAddress, assetId: ASSETS.USDC.assetId, amount: "50000000" })).toBeNull();
  });
});

describe("balances", () => {
  it("reads every asset we offer from intents.near", async () => {
    const balances = await real.balances(ACCOUNT, ASSET_SYMBOLS.map((symbol) => ASSETS[symbol].assetId));
    expect(balances.length).toBe(ASSET_SYMBOLS.length);
    for (const balance of balances) expect(balance).toMatch(/^\d+$/);
  });
});
