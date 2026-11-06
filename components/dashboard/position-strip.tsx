"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { RiBankLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { formatUsd, shortAddress } from "@/lib/format";
import { metricsNow } from "@/lib/metrics";
import { formatPayoutDate, ledger, nextPayoutAt, nextPayoutEstimate } from "@/lib/payouts";
import { useGateway } from "@/lib/store";
import { plural } from "./fmt";
import { preloadPayoutDialog } from "./preload";

const PayoutDialog = dynamic(() => preloadPayoutDialog().then((module) => module.PayoutDialog), { ssr: false });

function Cell({ href, label, value, note }: { href: string; label: string; value: string; note: string }) {
  return (
    <Link href={href} className="pos-cell">
      <span className="truncate text-body-regular text-text-secondary">{label}</span>
      <span className="dash-figure truncate">{value}</span>
      <span className="text-caption-1-regular text-text-secondary">{note}</span>
    </Link>
  );
}

/** The merchant's position, in the order money moves through it. */
export function PositionStrip() {
  const { payments, payouts, settings, settlement, prices } = useGateway();
  const [paying, setPaying] = useState(false);
  const [armed, setArmed] = useState(false);
  if (paying && !armed) setArmed(true);
  const { holdDays, schedule } = settings.payouts;
  const now = metricsNow(payments);
  const position = useMemo(() => ledger(payments, payouts, holdDays, now, settlement, prices), [payments, payouts, holdDays, now, settlement, prices]);
  const next = nextPayoutAt(schedule, now);

  return (
    <section aria-label="Your position" className="stage-plate pos-strip">
      <div className="pos-grid">
        <Cell href="/dashboard/payments?status=processing" label="Arriving" value={formatUsd(position.arrivingUsd)} note={position.arrivingCount ? `${plural(position.arrivingCount, "payment")} in flight` : "Nothing in flight"} />
        <Cell href="/dashboard/payouts#hold" label="On hold" value={formatUsd(position.heldUsd)} note={holdDays ? `${holdDays}-day refund window` : "No refund window set"} />
        <Cell href="/dashboard/payouts" label="Available" value={settlement.balancesFresh ? formatUsd(position.availableUsd) : "Unavailable"} note={settlement.balancesFresh ? `Paid out ${formatUsd(position.paidOutUsd)} to date` : "Couldn't read your balance just now"} />
        <div className="pos-cell pos-next">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-body-regular text-text-secondary">{next ? `Payout reminder, ${formatPayoutDate(next)}` : "You choose when to pay out"}</span>
            <span className="truncate text-title-2-semibold tabular-nums">{next ? `About ${formatUsd(nextPayoutEstimate(position, next))}` : "Manual"}</span>
            <span dir="ltr" className="truncate text-start text-caption-1-regular text-text-secondary">To {shortAddress(settings.walletAddress)}</span>
          </div>
          <Button leadingIcon={RiBankLine} disabled={position.availableUsd <= 0} onClick={() => setPaying(true)}>Pay out</Button>
        </div>
      </div>
      {armed && <PayoutDialog isOpen={paying} onOpenChange={setPaying} />}
    </section>
  );
}
