import type { PaymentStatus } from "@/lib/types";
import type { ProviderStatus } from "./provider/types";

export type PaymentState =
  | "quoting"
  | "quote_failed"
  | "awaiting_deposit"
  | "deposit_seen"
  | "incomplete_deposit"
  | "processing"
  | "settled"
  | "underpaid"
  | "provider_refunded"
  | "failed"
  | "expired"
  | "refund_pending"
  | "refunded";

const FROM_PROVIDER: Record<Exclude<ProviderStatus, "PENDING_DEPOSIT">, PaymentState> = {
  KNOWN_DEPOSIT_TX: "deposit_seen",
  INCOMPLETE_DEPOSIT: "incomplete_deposit",
  PROCESSING: "processing",
  SUCCESS: "settled",
  REFUNDED: "provider_refunded",
  FAILED: "failed",
};

/** How far along each state is. A later poll must never move a payment backwards. */
const PROGRESS: Partial<Record<PaymentState, number>> = {
  awaiting_deposit: 0,
  expired: 0,
  deposit_seen: 1,
  incomplete_deposit: 1,
  processing: 2,
  failed: 3,
  provider_refunded: 4,
  settled: 4,
  underpaid: 4,
};

/**
 * Where a provider status takes a payment, or null to stay put. Pure, so every path is tested.
 *
 * `PENDING_DEPOSIT` means "not seen yet", never "unpaid", so it changes nothing. `expired` isn't final:
 * money that turns up late moves the payment on. Once a merchant refund has started, that flow owns the
 * state. `settled` and `provider_refunded` are final for the provider.
 */
export function nextPaymentState(current: PaymentState, status: ProviderStatus): PaymentState | null {
  if (status === "PENDING_DEPOSIT") return null;
  const target = FROM_PROVIDER[status];
  if (target === current) return null;
  // States with no progress rank are never moved by a poll: no address yet, or a refund owns them.
  const from = PROGRESS[current];
  const to = PROGRESS[target];
  if (from === undefined || to === undefined) return null;
  if (current === "settled" || current === "underpaid" || current === "provider_refunded") return null;
  // incomplete_deposit and deposit_seen rank equally: a top-up can move either way between them.
  return to >= from ? target : null;
}

/** The provider reached an outcome. A later second deposit is undocumented, so these are still looked at, slowly. */
export const isFinalForProvider = (state: PaymentState) => state === "settled" || state === "underpaid" || state === "provider_refunded" || state === "refund_pending" || state === "refunded";

/** No address was ever issued to anyone, so nothing can arrive. */
export const isDeadOnArrival = (state: PaymentState) => state === "quote_failed";

const DAY = 86_400_000;
const LATE_TRACKING_DAYS = 30;

/**
 * When to look again, or null to stop. Fast while a customer is watching, then slower. An address that
 * stayed quiet is still checked for a month past its deadline, because a late deposit is still money.
 */
export function nextPollDelayMs(input: { state: PaymentState; now: number; createdAt: number; deadline: number | null; failures: number }): number | null {
  const { state, now, createdAt, deadline, failures } = input;
  if (isDeadOnArrival(state)) return null;
  const lastDay = (deadline ?? createdAt) + LATE_TRACKING_DAYS * DAY;
  const moving = state === "deposit_seen" || state === "processing" || state === "incomplete_deposit" || state === "failed";
  // However long the provider keeps failing, even a revoked key: once it's back, money in flight must still get an answer.
  if (failures > 0) return !moving && now > lastDay ? null : Math.min(30_000 * 2 ** Math.min(failures, 6), 1_800_000);
  // Money in flight always gets an answer, so these never stop, however long the provider takes.
  if (moving) {
    const age = now - createdAt;
    return age < 3_600_000 ? 10_000 : age < DAY ? 60_000 : 600_000;
  }
  if (now > lastDay) return null;
  // A finished address is only checked for a second deposit reaching the provider.
  if (isFinalForProvider(state)) return 6 * 3_600_000;
  const age = now - createdAt;
  if (age < 3_600_000) return 10_000;
  // An abandoned checkout costs a request per poll for a month, so quiet addresses are asked rarely.
  if (deadline !== null && now < deadline) return 300_000;
  return 6 * 3_600_000;
}

/** A quiet payment is shown as expired once the customer's countdown is over. Moves on if money appears. */
export const shouldExpire = (state: PaymentState, now: number, payBy: number | null) => state === "awaiting_deposit" && payBy !== null && now > payBy;

/** Whether the dashboard shows this as a payment. Nothing has happened yet before a deposit or expiry. */
export const isVisiblePayment = (state: PaymentState) => state !== "quoting" && state !== "quote_failed" && state !== "awaiting_deposit";

export function dashboardStatus(state: PaymentState): PaymentStatus {
  switch (state) {
    case "settled":
    case "refund_pending":
      return "settled";
    case "refunded":
      return "refunded";
    case "expired":
      return "expired";
    case "failed":
    case "provider_refunded":
    case "quote_failed":
    case "underpaid":
      return "failed";
    default:
      return "processing";
  }
}

/** The webhook event for a state, if it is one merchants hear about. */
export function webhookEventFor(state: PaymentState): string | null {
  switch (state) {
    case "deposit_seen":
    case "processing":
      return "payment.processing";
    case "settled":
      return "payment.settled";
    case "refunded":
      return "payment.refunded";
    case "expired":
      return "payment.expired";
    case "failed":
    case "provider_refunded":
      return "payment.failed";
    // Not a failure: the merchant holds what arrived, and a server must not treat this as a lost sale.
    case "underpaid":
      return "payment.underpaid";
    default:
      return null;
  }
}

/** FAILED isn't REFUNDED: a move may yet go through, so it stays reserved and watched this long after failing. */
export const WATCH_FAILED_MS = 86_400_000;
/** A signed intent can't execute past its deadline, but the status can lag behind one that landed just before it. */
export const RELEASE_GRACE_MS = 5 * 60_000;

/**
 * The next look at a failed move, or null once it's settled. REFUNDED is final: the funds are confirmed
 * back. A provider saying it's moving again means money in flight, which never stops being tracked.
 */
export function nextFailedPoll(status: ProviderStatus, failedAt: Date, now: Date) {
  if (status === "REFUNDED") return null;
  const moving = status === "PROCESSING" || status === "KNOWN_DEPOSIT_TX" || status === "SUCCESS";
  return moving || now.getTime() - failedAt.getTime() < WATCH_FAILED_MS ? new Date(now.getTime() + 300_000) : null;
}

/** Payouts and refunds follow the same provider statuses, with these outcomes. */
export type IntentState = "awaiting_signature" | "submitting" | "processing" | "done" | "failed" | "expired";

export function nextIntentState(current: IntentState, status: ProviderStatus): IntentState | null {
  if (current === "done" || current === "awaiting_signature" || current === "expired") return null;
  if (status === "SUCCESS") return "done";
  if (status === "FAILED" || status === "REFUNDED") return "failed";
  if (status === "PROCESSING" || status === "KNOWN_DEPOSIT_TX") return current === "failed" ? null : "processing";
  return null;
}
