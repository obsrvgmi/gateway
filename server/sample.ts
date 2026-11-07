import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { ASSETS } from "@/lib/assets";
import { decimalToBase } from "@/lib/money";
import { DEMO_NOW, SAMPLE } from "@/lib/seed";
import type { AssetSymbol } from "@/lib/types";
import { db, schema } from "./db";
import { newId } from "./ids";

const toBase = (amount: number, asset: AssetSymbol) => decimalToBase(amount.toFixed(Math.min(ASSETS[asset].tokenDecimals, 8)), ASSETS[asset].tokenDecimals).toString();

const STATE = { settled: "settled", processing: "processing", refunded: "refunded", expired: "expired", failed: "failed" } as const;

/** Test mode only: a realistic history to look around with. Every row is marked `sample` and removable. */
export async function loadSample(orgId: string) {
  const shift = Date.now() - DEMO_NOW;
  const moved = (iso: string) => new Date(new Date(iso).getTime() + shift);
  const ids = new Map<string, string>();
  const mapId = (id: string, prefix: string) => {
    if (!ids.has(id)) ids.set(id, newId(prefix));
    return ids.get(id) as string;
  };
  await db().transaction(async (tx) => {
    await tx.insert(schema.paymentLinks).values(SAMPLE.links.map((link) => ({ id: mapId(link.id, "lnk_"), orgId, title: link.title, description: link.description, amountUsd: link.amount?.toFixed(2) ?? null, receiveAsset: link.receiveAsset, status: link.status, expiresAt: link.expiresAt ? moved(link.expiresAt) : null, successUrl: link.successUrl, sample: true, createdAt: moved(link.createdAt) })));
    await tx.insert(schema.widgets).values(SAMPLE.widgets.map((widget) => ({ id: mapId(widget.id, "wgt_"), orgId, name: widget.name, site: widget.site, status: widget.status, theme: widget.theme, accent: widget.accent, radius: widget.radius, amountUsd: widget.amount?.toFixed(2) ?? null, receiveAsset: widget.receiveAsset, buttonLabel: widget.buttonLabel, showBranding: widget.showBranding, acceptedAssets: widget.acceptedAssets, presets: widget.presets, displayName: widget.displayName, logo: widget.logo, collectEmail: widget.collectEmail, success: widget.success, sample: true, createdAt: moved(widget.createdAt) })));
    const rows = SAMPLE.payments.map((payment) => {
      const createdAt = moved(payment.createdAt);
      const settled = payment.status === "settled" || payment.status === "refunded";
      const received = toBase(payment.receiveAmount, payment.receiveAsset);
      return {
        id: newId("pay_"),
        orgId,
        sourceType: payment.sourceType,
        sourceId: ids.get(payment.sourceId) ?? payment.sourceId,
        sourceName: payment.sourceName,
        state: STATE[payment.status],
        payAsset: payment.payAsset,
        receiveAsset: payment.receiveAsset,
        usd: payment.usd.toFixed(6),
        feeUsd: (payment.payAmount * ASSETS[payment.payAsset].usd - payment.usd > 0 ? payment.payAmount * ASSETS[payment.payAsset].usd - payment.usd : 0).toFixed(6),
        payBase: toBase(payment.payAmount, payment.payAsset),
        receiveBase: received,
        receivedBase: settled ? received : null,
        refundedBase: payment.status === "refunded" ? received : "0",
        payer: payment.payer,
        settlementMode: "balance",
        recipient: "sample",
        recipientType: "SAMPLE",
        settleSeconds: payment.settleSeconds,
        live: false,
        sample: true,
        depositSeenAt: settled ? createdAt : null,
        settledAt: settled && payment.settleSeconds !== null ? new Date(createdAt.getTime() + payment.settleSeconds * 1000) : null,
        refundedAt: payment.refundedAt ? moved(payment.refundedAt) : null,
        createdAt,
        updatedAt: createdAt,
      };
    });
    for (let i = 0; i < rows.length; i += 500) await tx.insert(schema.payments).values(rows.slice(i, i + 500));
    const payouts = SAMPLE.payouts.map((payout) => ({
      id: newId("pyt_"),
      orgId,
      state: payout.status,
      asset: payout.asset,
      amountBase: toBase(payout.amount, payout.asset),
      receiveAsset: payout.receiveAsset,
      receiveBase: toBase(payout.receiveAmount, payout.receiveAsset),
      minReceiveBase: toBase(payout.receiveAmount, payout.receiveAsset),
      usd: payout.usd.toFixed(6),
      feeUsd: payout.feeUsd.toFixed(6),
      destinationId: payout.destinationId,
      destinationLabel: payout.destinationLabel,
      destinationAddress: payout.destinationAddress,
      trigger: payout.trigger,
      paymentCount: payout.paymentCount,
      signer: "sample",
      failureReason: payout.failureReason ?? null,
      live: false,
      sample: true,
      createdAt: moved(payout.createdAt),
      completedAt: payout.completedAt ? moved(payout.completedAt) : null,
    }));
    for (let i = 0; i < payouts.length; i += 500) await tx.insert(schema.payouts).values(payouts.slice(i, i + 500));
  });
}

export async function clearSample(orgId: string) {
  await db().transaction(async (tx) => {
    await tx.delete(schema.payouts).where(and(eq(schema.payouts.orgId, orgId), eq(schema.payouts.sample, true)));
    await tx.delete(schema.payments).where(and(eq(schema.payments.orgId, orgId), eq(schema.payments.sample, true)));
    await tx.delete(schema.paymentLinks).where(and(eq(schema.paymentLinks.orgId, orgId), eq(schema.paymentLinks.sample, true)));
    await tx.delete(schema.widgets).where(and(eq(schema.widgets.orgId, orgId), eq(schema.widgets.sample, true)));
  });
}

export const hasSample = async (orgId: string) => (await db().select({ id: schema.paymentLinks.id }).from(schema.paymentLinks).where(and(eq(schema.paymentLinks.orgId, orgId), inArray(schema.paymentLinks.sample, [true]))).limit(1)).length > 0;
