import { describe, expect, it } from "vitest";
import { ledger } from "@/lib/payouts";
import type { Payment, Payout } from "@/lib/types";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 6, 12);

function payment(overrides: Partial<Payment>): Payment {
  return {
    id: "pay_1",
    sourceType: "link",
    sourceId: "lnk_1",
    sourceName: "Test",
    payAsset: "ETH",
    payAmount: 1,
    receiveAsset: "USDC",
    receiveAmount: 100,
    usd: 100,
    status: "settled",
    payer: "0xabc",
    settleSeconds: 30,
    createdAt: new Date(NOW - 10 * DAY).toISOString(),
    ...overrides,
  };
}

function payout(overrides: Partial<Payout>): Payout {
  return {
    id: "pyt_1",
    asset: "USDC",
    amount: 30,
    receiveAsset: "USDC",
    receiveAmount: 30,
    usd: 30,
    feeUsd: 0,
    destinationId: "dst_1",
    destinationLabel: "Wallet",
    destinationAddress: "0xabc",
    status: "sent",
    trigger: "manual",
    paymentCount: 1,
    reference: "ref",
    createdAt: new Date(NOW - DAY).toISOString(),
    completedAt: null,
    ...overrides,
  };
}

describe("ledger", () => {
  it("splits payments into arriving, on hold and available", () => {
    const result = ledger(
      [
        payment({ id: "old", usd: 100, receiveAmount: 100 }),
        payment({ id: "held", usd: 50, receiveAmount: 50, createdAt: new Date(NOW - DAY).toISOString() }),
        payment({ id: "moving", status: "processing", usd: 25, receiveAmount: 25 }),
      ],
      [],
      3,
      NOW,
    );
    expect(result.availableUsd).toBe(100);
    expect(result.heldUsd).toBe(50);
    expect(result.arrivingUsd).toBe(25);
  });

  it("takes payouts off available, but not failed ones", () => {
    const payments = [payment({})];
    expect(ledger(payments, [payout({ status: "sent" })], 0, NOW).availableUsd).toBe(70);
    expect(ledger(payments, [payout({ status: "processing" })], 0, NOW).availableUsd).toBe(70);
    expect(ledger(payments, [payout({ status: "failed" })], 0, NOW).availableUsd).toBe(100);
  });

  it("reports a refund after a payout as a shortfall, not negative availability", () => {
    const result = ledger([payment({ status: "refunded" })], [payout({ amount: 30, usd: 30 })], 0, NOW);
    expect(result.available).toEqual([]);
    expect(result.shortfall.map((entry) => entry.asset)).toEqual(["USDC"]);
  });
});
