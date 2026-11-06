"use client";

import { toast } from "@/components/base/toast/toast";
import { formatToken } from "@/lib/format";
import { actions, getGateway } from "@/lib/store";

export const PAYOUT_STEPS = [
  { label: "Preparing the sweep", ms: 800 },
  { label: "Routing through NEAR Intents", ms: 1100 },
  { label: "Arriving at destination", ms: 900 },
];

let watched: string | null = null;
/** The dialog tells the story while it's open, so the toast only speaks once it's been hidden. */
export function watchPayout(id: string | null) {
  watched = id;
}

/** A timed story, like the checkout. Lives outside the dialog, so closing it doesn't strand the payout. */
export function runPayout(id: string) {
  const total = PAYOUT_STEPS.reduce((sum, step) => sum + step.ms, 0);
  window.setTimeout(() => {
    const payout = getGateway().payouts.find((item) => item.id === id);
    if (payout?.status !== "processing") return;
    actions.updatePayout(id, { status: "sent", completedAt: new Date(new Date(payout.createdAt).getTime() + 94_000).toISOString() });
    if (watched !== id) toast.success(`Payout sent to ${payout.destinationLabel}`, { id: `payout-${id}`, description: `${formatToken(payout.receiveAmount, payout.receiveAsset)}. Simulated. No funds moved.` });
  }, total);
}
