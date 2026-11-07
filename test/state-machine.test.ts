import { describe, expect, it } from "vitest";
import { dashboardStatus, isVisiblePayment, nextIntentState, nextPaymentState, nextPollDelayMs, shouldExpire, type PaymentState } from "@/server/payments/state-machine";
import type { ProviderStatus } from "@/server/payments/provider/types";

const STATES: PaymentState[] = ["quoting", "quote_failed", "awaiting_deposit", "deposit_seen", "incomplete_deposit", "processing", "settled", "underpaid", "provider_refunded", "failed", "expired", "refund_pending", "refunded"];
const STATUSES: ProviderStatus[] = ["KNOWN_DEPOSIT_TX", "PENDING_DEPOSIT", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"];

describe("nextPaymentState", () => {
  it("walks the happy path", () => {
    expect(nextPaymentState("awaiting_deposit", "KNOWN_DEPOSIT_TX")).toBe("deposit_seen");
    expect(nextPaymentState("deposit_seen", "PROCESSING")).toBe("processing");
    expect(nextPaymentState("processing", "SUCCESS")).toBe("settled");
  });

  it("never reads PENDING_DEPOSIT as unpaid", () => {
    for (const state of STATES) expect(nextPaymentState(state, "PENDING_DEPOSIT")).toBeNull();
  });

  it("moves an expired payment forward when money turns up late", () => {
    expect(nextPaymentState("expired", "KNOWN_DEPOSIT_TX")).toBe("deposit_seen");
    expect(nextPaymentState("expired", "PROCESSING")).toBe("processing");
    expect(nextPaymentState("expired", "SUCCESS")).toBe("settled");
    expect(nextPaymentState("expired", "REFUNDED")).toBe("provider_refunded");
  });

  it("never moves a finished payment", () => {
    for (const status of STATUSES) {
      expect(nextPaymentState("settled", status)).toBeNull();
      expect(nextPaymentState("underpaid", status)).toBeNull();
      expect(nextPaymentState("provider_refunded", status)).toBeNull();
    }
  });

  it("never lets a late poll undo a merchant refund", () => {
    for (const status of STATUSES) {
      expect(nextPaymentState("refund_pending", status)).toBeNull();
      expect(nextPaymentState("refunded", status)).toBeNull();
    }
  });

  it("never moves backwards", () => {
    expect(nextPaymentState("processing", "KNOWN_DEPOSIT_TX")).toBeNull();
    expect(nextPaymentState("processing", "INCOMPLETE_DEPOSIT")).toBeNull();
    expect(nextPaymentState("failed", "PROCESSING")).toBeNull();
  });

  it("lets a top-up take an incomplete deposit to settled", () => {
    expect(nextPaymentState("awaiting_deposit", "INCOMPLETE_DEPOSIT")).toBe("incomplete_deposit");
    expect(nextPaymentState("incomplete_deposit", "PROCESSING")).toBe("processing");
    expect(nextPaymentState("incomplete_deposit", "SUCCESS")).toBe("settled");
    expect(nextPaymentState("incomplete_deposit", "REFUNDED")).toBe("provider_refunded");
  });

  it("lets a failed payment reach its refund, or success if the provider says so", () => {
    expect(nextPaymentState("failed", "REFUNDED")).toBe("provider_refunded");
    expect(nextPaymentState("failed", "SUCCESS")).toBe("settled");
  });

  it("ignores a payment with no address", () => {
    for (const status of STATUSES) {
      expect(nextPaymentState("quoting", status)).toBeNull();
      expect(nextPaymentState("quote_failed", status)).toBeNull();
    }
  });

  it("stays put on a repeated status", () => {
    expect(nextPaymentState("processing", "PROCESSING")).toBeNull();
  });
});

describe("nextPollDelayMs", () => {
  const NOW = 1_800_000_000_000;
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const input = (overrides: Partial<Parameters<typeof nextPollDelayMs>[0]>) => ({ state: "awaiting_deposit" as PaymentState, now: NOW, createdAt: NOW, deadline: NOW + 3 * DAY, failures: 0, ...overrides });

  it("polls fast while a customer is waiting", () => {
    expect(nextPollDelayMs(input({}))).toBe(10_000);
    expect(nextPollDelayMs(input({ state: "processing" }))).toBe(10_000);
  });

  it("slows down, but keeps watching past the deadline", () => {
    expect(nextPollDelayMs(input({ createdAt: NOW - 2 * HOUR }))).toBe(300_000);
    expect(nextPollDelayMs(input({ state: "expired", createdAt: NOW - 5 * DAY, deadline: NOW - 2 * DAY }))).toBe(6 * HOUR);
  });

  it("gives up on a quiet address a month after its deadline, not before", () => {
    expect(nextPollDelayMs(input({ state: "expired", createdAt: NOW - 40 * DAY, deadline: NOW - 29 * DAY }))).toBe(6 * HOUR);
    expect(nextPollDelayMs(input({ state: "expired", createdAt: NOW - 40 * DAY, deadline: NOW - 31 * DAY }))).toBeNull();
  });

  it("keeps polling a failed payment, which may still reach a refund", () => {
    expect(nextPollDelayMs(input({ state: "failed", createdAt: NOW - 2 * HOUR }))).toBe(60_000);
  });

  it("never stops asking about money in flight, only slows down", () => {
    expect(nextPollDelayMs(input({ state: "processing", createdAt: NOW - 2 * HOUR }))).toBe(60_000);
    expect(nextPollDelayMs(input({ state: "deposit_seen", createdAt: NOW - 400 * DAY, deadline: NOW - 397 * DAY }))).toBe(600_000);
  });

  it("stops on a payment that never got an address", () => {
    expect(nextPollDelayMs(input({ state: "quote_failed" }))).toBeNull();
  });

  it("checks a finished address slowly for a month, in case of a second deposit", () => {
    for (const state of ["settled", "provider_refunded", "refund_pending", "refunded"] as PaymentState[]) {
      expect(nextPollDelayMs(input({ state }))).toBe(6 * HOUR);
      expect(nextPollDelayMs(input({ state, createdAt: NOW - 40 * DAY, deadline: NOW - 31 * DAY }))).toBeNull();
    }
  });

  it("backs off when the provider is failing, up to a limit", () => {
    expect(nextPollDelayMs(input({ failures: 1 }))).toBe(60_000);
    expect(nextPollDelayMs(input({ failures: 20 }))).toBe(1_800_000);
  });

  it("never gives up on money in flight, however long the provider keeps failing", () => {
    for (const state of ["deposit_seen", "processing", "incomplete_deposit", "failed"] as PaymentState[]) {
      expect(nextPollDelayMs(input({ state, createdAt: NOW - 400 * DAY, deadline: NOW - 397 * DAY, failures: 5000 }))).toBe(1_800_000);
    }
  });

  it("does give up on a quiet address a month after its deadline", () => {
    expect(nextPollDelayMs(input({ state: "expired", createdAt: NOW - 40 * DAY, deadline: NOW - 31 * DAY, failures: 3 }))).toBeNull();
  });
});

describe("shouldExpire", () => {
  it("expires only a quiet payment past the customer's countdown", () => {
    expect(shouldExpire("awaiting_deposit", 200, 100)).toBe(true);
    expect(shouldExpire("awaiting_deposit", 50, 100)).toBe(false);
    expect(shouldExpire("deposit_seen", 200, 100)).toBe(false);
    expect(shouldExpire("awaiting_deposit", 200, null)).toBe(false);
  });
});

describe("dashboard mapping", () => {
  it("doesn't show a payment until something has happened", () => {
    expect(isVisiblePayment("quoting")).toBe(false);
    expect(isVisiblePayment("quote_failed")).toBe(false);
    expect(isVisiblePayment("awaiting_deposit")).toBe(false);
    expect(isVisiblePayment("deposit_seen")).toBe(true);
    expect(isVisiblePayment("expired")).toBe(true);
  });

  it("counts only money on the way as processing", () => {
    expect(dashboardStatus("deposit_seen")).toBe("processing");
    expect(dashboardStatus("processing")).toBe("processing");
    expect(dashboardStatus("incomplete_deposit")).toBe("processing");
    expect(dashboardStatus("settled")).toBe("settled");
    expect(dashboardStatus("refund_pending")).toBe("settled");
    expect(dashboardStatus("refunded")).toBe("refunded");
    expect(dashboardStatus("expired")).toBe("expired");
    expect(dashboardStatus("provider_refunded")).toBe("failed");
    expect(dashboardStatus("failed")).toBe("failed");
    expect(dashboardStatus("underpaid")).toBe("failed");
  });
});

describe("nextIntentState", () => {
  it("follows the provider once submitted", () => {
    expect(nextIntentState("submitting", "PROCESSING")).toBe("processing");
    expect(nextIntentState("processing", "SUCCESS")).toBe("done");
    expect(nextIntentState("processing", "FAILED")).toBe("failed");
    expect(nextIntentState("processing", "REFUNDED")).toBe("failed");
  });

  it("ignores polls before a signature, and after completion", () => {
    for (const status of STATUSES) {
      expect(nextIntentState("awaiting_signature", status)).toBeNull();
      expect(nextIntentState("done", status)).toBeNull();
    }
  });

  it("lets a late success correct a failure", () => {
    expect(nextIntentState("failed", "SUCCESS")).toBe("done");
    expect(nextIntentState("failed", "PROCESSING")).toBeNull();
  });
});
