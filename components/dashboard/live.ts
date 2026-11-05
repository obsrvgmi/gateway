"use client";

import { actions, getGateway, newId } from "@/lib/store";
import { quote } from "@/lib/assets";
import { settleRange } from "@/lib/seed";
import type { AssetSymbol } from "@/lib/types";

const PAY_MIX: AssetSymbol[] = ["ETH", "ETH", "SOL", "SOL", "BTC", "USDT", "NEAR", "ARB"];

/** Adds an in-flight payment, then settles it a few seconds later. Time is compressed for the demo. */
export function simulatePayment(settleAfterMs = 4500) {
  const { links, widgets } = getGateway();
  const sources = [
    ...links.filter((link) => link.status === "active").map((link) => ({ id: link.id, name: link.title, type: "link" as const, amount: link.amount, receiveAsset: link.receiveAsset })),
    ...widgets.filter((widget) => widget.status === "live").map((widget) => ({ id: widget.id, name: widget.name, type: "widget" as const, amount: widget.amount, receiveAsset: widget.receiveAsset })),
  ].filter((source) => (source.amount ?? 0) < 1000);
  if (sources.length === 0) return false;
  const source = sources[Math.floor(Math.random() * sources.length)];
  const usd = source.amount ?? [29, 49, 79, 120, 240][Math.floor(Math.random() * 5)];
  const payAsset = PAY_MIX[Math.floor(Math.random() * PAY_MIX.length)];
  const { payAmount, receiveAmount } = quote(usd, payAsset, source.receiveAsset);
  const id = newId("pay_");
  actions.recordPayment({
    id,
    sourceType: source.type,
    sourceId: source.id,
    sourceName: source.name,
    payAsset,
    payAmount,
    receiveAsset: source.receiveAsset,
    receiveAmount,
    usd,
    status: "processing",
    payer: `0x${newId("", 40).replace(/[g-z]/g, (c) => (c.charCodeAt(0) % 16).toString(16))}`,
    settleSeconds: null,
    createdAt: new Date().toISOString(),
    simulated: true,
  });
  const [fastest, slowest] = settleRange(payAsset);
  window.setTimeout(() => actions.settlePayment(id, fastest + Math.floor(Math.random() * (slowest - fastest + 1))), settleAfterMs);
  return true;
}
