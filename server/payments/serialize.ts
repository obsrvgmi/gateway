import { ASSETS } from "@/lib/assets";
import type { AssetSymbol, Payment, PaymentDetail, Payout } from "@/lib/types";
import { schema } from "../db";
import { baseToNumber } from "@/lib/money";
import { dashboardStatus, type PaymentState } from "./state-machine";

type PaymentRow = typeof schema.payments.$inferSelect;
type PayoutRow = typeof schema.payouts.$inferSelect;

export function toPayment(row: PaymentRow): Payment {
  const pay = row.payAsset as AssetSymbol;
  const receive = row.receiveAsset as AssetSymbol;
  const state = row.state as PaymentState;
  const detail: PaymentDetail = {
    state,
    direct: row.recipientType === "DESTINATION_CHAIN",
    depositAddress: row.depositAddress,
    depositedAt: row.depositSeenAt?.toISOString() ?? null,
    settledAt: row.settledAt?.toISOString() ?? null,
    originTxs: row.originTxHashes,
    destinationTxs: row.destinationTxHashes,
    failureReason: row.failureReason,
    returnedToCustomer: state === "provider_refunded",
    customerEmail: row.customerEmail,
    refundState: state === "refund_pending" ? "pending" : null,
    refundedUsd: BigInt(row.receiveBase) > 0n ? (Number(row.refundedBase) / Number(row.receiveBase)) * Number(row.usd) : 0,
  };
  return {
    id: row.id,
    sourceType: row.sourceType as Payment["sourceType"],
    sourceId: row.sourceId,
    sourceName: row.sourceName,
    payAsset: pay,
    payAmount: row.payBase ? baseToNumber(row.depositedBase ?? row.payBase, pay) : 0,
    receiveAsset: receive,
    receiveAmount: baseToNumber(row.receivedBase ?? row.receiveBase, receive),
    usd: Number(row.usd),
    status: dashboardStatus(state),
    payer: row.payer,
    settleSeconds: row.settleSeconds,
    createdAt: row.createdAt.toISOString(),
    feeUsd: Number(row.feeUsd),
    ...(row.refundedAt ? { refundedAt: row.refundedAt.toISOString() } : {}),
    ...(row.live ? {} : { simulated: true }),
    detail,
  };
}

const PAYOUT_STATUS: Record<string, Payout["status"]> = { awaiting_signature: "awaiting_signature", submitting: "processing", processing: "processing", sent: "sent", failed: "failed", expired: "expired" };

export function toPayout(row: PayoutRow): Payout {
  const tx = row.destinationTxHashes[0];
  return {
    id: row.id,
    asset: row.asset as AssetSymbol,
    amount: baseToNumber(row.amountBase, row.asset as AssetSymbol),
    receiveAsset: row.receiveAsset as AssetSymbol,
    receiveAmount: baseToNumber(row.receiveBase, row.receiveAsset as AssetSymbol),
    usd: Number(row.usd),
    feeUsd: Number(row.feeUsd),
    destinationId: row.destinationId,
    destinationLabel: row.destinationLabel,
    destinationAddress: row.destinationAddress,
    status: PAYOUT_STATUS[row.state] ?? "processing",
    trigger: row.trigger as Payout["trigger"],
    paymentCount: row.paymentCount,
    reference: tx?.hash ?? row.intentHash ?? row.id,
    ...(tx?.explorerUrl ? { explorerUrl: tx.explorerUrl } : {}),
    ...(row.live ? {} : { simulated: true }),
    createdAt: row.createdAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    ...(row.failureReason ? { failureReason: row.failureReason } : {}),
    ...(row.state === "failed" && row.nextPollAt ? { watching: true } : {}),
  };
}

/** The body of a `payment.*` webhook. A stable, documented shape, not the internal row. */
export function paymentEventBody(row: PaymentRow) {
  const pay = ASSETS[row.payAsset as AssetSymbol];
  const receive = ASSETS[row.receiveAsset as AssetSymbol];
  return {
    id: row.id,
    status: dashboardStatus(row.state as PaymentState),
    state: row.state,
    live: row.live,
    source: { type: row.sourceType, id: row.sourceId, name: row.sourceName },
    amount_usd: Number(row.usd),
    pay: { asset: row.payAsset, chain: pay.chain, amount_base: row.depositedBase ?? row.payBase, decimals: pay.tokenDecimals },
    receive: { asset: row.receiveAsset, chain: receive.chain, amount_base: row.receivedBase ?? row.receiveBase, decimals: receive.tokenDecimals },
    payer: row.payer,
    customer_email: row.customerEmail,
    origin_tx_hashes: row.originTxHashes.map((tx) => tx.hash),
    destination_tx_hashes: row.destinationTxHashes.map((tx) => tx.hash),
    created_at: row.createdAt.toISOString(),
    settled_at: row.settledAt?.toISOString() ?? null,
  };
}
