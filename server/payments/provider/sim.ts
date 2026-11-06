import { randomBytes } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";
import { eq, sql } from "drizzle-orm";
import { ASSETS } from "@/lib/assets";
import { quoteMessage, VERIFIER_CONTRACT, type SignedQuote } from "@/lib/intents";
import { db, schema } from "../../db";
import { baseToDecimal } from "@/lib/money";
import { ProviderRejected, type GeneratedIntent, type QuoteRequest, type QuoteResponse, type StatusResponse, type SwapProvider, type TokenInfo } from "./types";

/** Test mode only. A fresh key per process: quotes are verified by the process that requested them. */
const secretKey = randomBytes(32);
export const SIM_QUOTE_KEY = `ed25519:${base58.encode(ed25519.getPublicKey(secretKey))}`;

const SPREAD_BPS = 30n;
const DEADLINE_MS = 3 * 86_400_000;
export const SIM_STEP_MS = { processing: 2_000, success: 5_000 };

export type SimScenario = "pay" | "underpay" | "fail";

const byId = new Map(Object.values(ASSETS).map((asset) => [asset.assetId, asset]));
const asset = (id: string) => {
  const found = byId.get(id);
  if (!found) throw new ProviderRejected(400, `Unknown asset ${id}`);
  return found;
};

const toUsd = (base: bigint, assetId: string) => Number(baseToDecimal(base, asset(assetId).tokenDecimals)) * asset(assetId).usd;

const fakeHash = () => `sim_${randomBytes(16).toString("hex")}`;
const ref = () => ({ hash: fakeHash(), explorerUrl: "" });

/** Same shapes and lifecycle as 1Click, no network and no money. Prices are the fixed illustrative ones. */
export class SimProvider implements SwapProvider {
  readonly kind = "sim" as const;
  readonly quoteKey = SIM_QUOTE_KEY;

  async tokens(): Promise<TokenInfo[]> {
    return Object.values(ASSETS).map((item) => ({ assetId: item.assetId, decimals: item.tokenDecimals, blockchain: item.blockchain, symbol: item.symbol, price: item.usd, priceUpdatedAt: new Date().toISOString() }));
  }

  async quote(request: QuoteRequest): Promise<QuoteResponse> {
    const origin = asset(request.originAsset);
    const destination = asset(request.destinationAsset);
    const same = origin.assetId === destination.assetId;
    const amount = BigInt(request.amount);
    const scale = (value: bigint, from: typeof origin, to: typeof origin) => {
      const priceFrom = BigInt(Math.round(from.usd * 1e8));
      const priceTo = BigInt(Math.round(to.usd * 1e8));
      return (value * priceFrom * 10n ** BigInt(to.tokenDecimals)) / (priceTo * 10n ** BigInt(from.tokenDecimals));
    };
    const spread = same ? 0n : SPREAD_BPS;
    const amountIn = request.swapType === "EXACT_OUTPUT" ? (scale(amount, destination, origin) * (10_000n + spread)) / 10_000n + 1n : amount;
    const amountOut = request.swapType === "EXACT_OUTPUT" ? amount : (scale(amount, origin, destination) * (10_000n - spread)) / 10_000n;
    const minAmountIn = request.swapType === "EXACT_OUTPUT" ? (amountIn * 9_900n) / 10_000n : amountIn;
    const minAmountOut = request.swapType === "EXACT_OUTPUT" ? amountOut : (amountOut * 9_900n) / 10_000n;
    const quote: QuoteResponse["quote"] = {
      amountIn: amountIn.toString(),
      amountInFormatted: baseToDecimal(amountIn, origin.tokenDecimals),
      amountInUsd: toUsd(amountIn, origin.assetId).toFixed(6),
      minAmountIn: minAmountIn.toString(),
      amountOut: amountOut.toString(),
      amountOutFormatted: baseToDecimal(amountOut, destination.tokenDecimals),
      amountOutUsd: toUsd(amountOut, destination.assetId).toFixed(6),
      minAmountOut: minAmountOut.toString(),
      timeEstimate: 7,
      refundFee: "0",
      withdrawFee: "0",
    };
    const echoed = { ...request, depositMode: "SIMPLE", confidentiality: "public", quoteWaitingTimeMs: 0, insured: false };
    if (!request.dry) {
      quote.depositAddress = `sim_${randomBytes(20).toString("hex")}`;
      const deadline = new Date(Date.now() + DEADLINE_MS).toISOString();
      quote.deadline = deadline;
      quote.timeWhenInactive = deadline;
      await db().insert(schema.simSwaps).values({ depositAddress: quote.depositAddress, status: "PENDING_DEPOSIT", request: echoed, quote });
    }
    const response = { quote, quoteRequest: echoed as Record<string, unknown>, timestamp: new Date().toISOString(), signature: "" };
    response.signature = `ed25519:${base58.encode(ed25519.sign(quoteMessage(response as SignedQuote), secretKey))}`;
    return response;
  }

  private async swap(depositAddress: string) {
    const [row] = await db().select().from(schema.simSwaps).where(eq(schema.simSwaps.depositAddress, depositAddress)).limit(1);
    if (!row) throw new ProviderRejected(404, "Deposit address not found");
    return row;
  }

  /** The test-mode "customer sends money" button. */
  async simulateDeposit(depositAddress: string, scenario: SimScenario) {
    const row = await this.swap(depositAddress);
    const quote = row.quote as QuoteResponse["quote"];
    const amount = BigInt(quote.amountIn);
    const deposited = scenario === "underpay" ? BigInt(quote.minAmountIn) / 2n : amount;
    const status = scenario === "underpay" ? "INCOMPLETE_DEPOSIT" : "KNOWN_DEPOSIT_TX";
    await db().update(schema.simSwaps).set({ status: scenario === "fail" ? "SIM_FAIL" : status, depositedBase: deposited.toString(), updatedAt: new Date() }).where(eq(schema.simSwaps.depositAddress, depositAddress));
  }

  async status(depositAddress: string): Promise<StatusResponse> {
    let row = await this.swap(depositAddress);
    const elapsed = Date.now() - row.updatedAt.getTime();
    const request = row.request as QuoteRequest;
    const quote = row.quote as QuoteResponse["quote"];

    // Advance by time, so the worker sees the same sequence it would see from the real service.
    let next = row.status;
    if (row.status === "SIM_FAIL" && elapsed > SIM_STEP_MS.processing) next = "REFUNDED";
    else if (row.status === "KNOWN_DEPOSIT_TX" && elapsed > SIM_STEP_MS.processing) next = "PROCESSING";
    else if (row.status === "PROCESSING" && elapsed > SIM_STEP_MS.success) next = "SUCCESS";
    if (next !== row.status) {
      // Claim the move, so two pollers can't credit a balance twice.
      const moved = await db().update(schema.simSwaps).set({ status: next, updatedAt: new Date() }).where(sql`${schema.simSwaps.depositAddress} = ${depositAddress} and ${schema.simSwaps.status} = ${row.status}`).returning();
      if (moved.length && next === "SUCCESS" && request.recipientType === "INTENTS") await this.credit(request.recipient, request.destinationAsset, BigInt(quote.amountOut));
      row = moved[0] ?? (await this.swap(depositAddress));
    }

    const status = row.status === "SIM_FAIL" ? "KNOWN_DEPOSIT_TX" : row.status;
    const seen = status !== "PENDING_DEPOSIT";
    const success = status === "SUCCESS";
    const refunded = status === "REFUNDED";
    return {
      status: status as StatusResponse["status"],
      updatedAt: row.updatedAt.toISOString(),
      swapDetails: {
        amountIn: success ? quote.amountIn : null,
        amountOut: success ? quote.amountOut : null,
        depositedAmount: seen ? (row.depositedBase ?? quote.amountIn) : null,
        refundedAmount: refunded ? (row.depositedBase ?? "0") : "0",
        refundReason: refunded ? "SIMULATED_FAILURE" : null,
        originChainTxHashes: seen ? [ref()] : [],
        destinationChainTxHashes: success ? [ref()] : [],
      },
    };
  }

  async submitDeposit() {
    // Nothing to speed up in test mode.
  }

  async generateIntent(input: { signerId: string; depositAddress: string }): Promise<GeneratedIntent> {
    const row = await this.swap(input.depositAddress);
    const request = row.request as QuoteRequest;
    return {
      intent: {
        standard: "erc191",
        payload: JSON.stringify({
          verifying_contract: VERIFIER_CONTRACT,
          signer_id: input.signerId,
          deadline: (row.quote as QuoteResponse["quote"]).deadline,
          nonce: randomBytes(32).toString("base64"),
          intents: [{ intent: "transfer", receiver_id: input.depositAddress, tokens: { [request.originAsset]: request.amount } }],
        }),
      },
    };
  }

  async submitIntent(input: { payload: string; signature: string }) {
    const payload = JSON.parse(input.payload) as { signer_id: string; intents: { receiver_id: string; tokens: Record<string, string> }[] };
    const [{ receiver_id: depositAddress, tokens }] = payload.intents;
    const [[assetId, amount]] = Object.entries(tokens);
    await this.debit(payload.signer_id, assetId, BigInt(amount));
    await db().update(schema.simSwaps).set({ status: "KNOWN_DEPOSIT_TX", depositedBase: amount, updatedAt: new Date() }).where(eq(schema.simSwaps.depositAddress, depositAddress));
    return { intentHash: `sim_${randomBytes(16).toString("hex")}` };
  }

  private async credit(account: string, assetId: string, amount: bigint) {
    await db().execute(sql`
      insert into sim_balances (account, asset_id, amount) values (${account}, ${assetId}, ${amount.toString()})
      on conflict (account, asset_id) do update set amount = sim_balances.amount + excluded.amount
    `);
  }

  private async debit(account: string, assetId: string, amount: bigint) {
    const result = await db().execute(sql`update sim_balances set amount = amount - ${amount.toString()} where account = ${account} and asset_id = ${assetId} and amount >= ${amount.toString()}`);
    if (!result.rowCount) throw new ProviderRejected(400, "insufficient balance or overflow");
  }

  async balances(account: string, assetIds: string[]): Promise<string[]> {
    const rows = await db().select().from(schema.simBalances).where(eq(schema.simBalances.account, account));
    return assetIds.map((id) => rows.find((row) => row.assetId === id)?.amount ?? "0");
  }
}
