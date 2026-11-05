"use client";

import { useState, type ReactNode } from "react";
import { RiArrowGoBackLine, RiCheckLine, RiCloseLine, RiLoader4Line } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Drawer, DrawerBody, DrawerFooter, DrawerHeader } from "@/components/base/drawer/drawer";
import { AlertDialog } from "@/components/base/modal/modal";
import { toast } from "@/components/base/toast/toast";
import { ASSETS } from "@/lib/assets";
import { formatToken, formatUsd, shortAddress } from "@/lib/format";
import { paymentTimeline, routeFee, type TimelineStep } from "@/lib/metrics";
import { actions, useGateway } from "@/lib/store";
import { cx } from "@/utils/cx";
import { formatClock, formatStamp } from "./fmt";
import { CopyButton, PaymentStatusChip } from "./ui";

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-body-regular text-text-secondary">{label}</dt>
      <dd className="min-w-0 text-end text-body-medium tabular-nums [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function StepMark({ state }: { state: TimelineStep["state"] }) {
  const base = "relative z-10 flex size-5 shrink-0 items-center justify-center rounded-full";
  if (state === "done") return <span className={cx(base, "bg-status-lime-background text-status-lime-text")}><RiCheckLine className="size-3.5" aria-hidden /></span>;
  if (state === "failed") return <span className={cx(base, "bg-status-rose-background text-status-rose-text")}><RiCloseLine className="size-3.5" aria-hidden /></span>;
  if (state === "current") return <span className={cx(base, "bg-status-yellow-background text-status-yellow-text")}><RiLoader4Line className="size-3.5 motion-safe:animate-spin" aria-hidden /></span>;
  return <span className={cx(base, "border border-border-button-default bg-background-primary-default")} />;
}

function Timeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <ol className="flex flex-col">
      {steps.map((step, index) => (
        <li key={step.label} className="relative flex gap-3 pb-4 last:pb-0">
          {index < steps.length - 1 && <span aria-hidden className="absolute start-[9.5px] top-5 bottom-0 w-px bg-separator-border" />}
          <StepMark state={step.state} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-body-medium">{step.label}</span>
            <span className="text-caption-1-regular text-text-secondary">{step.detail}</span>
          </div>
          {step.at && <span className="shrink-0 text-caption-1-regular text-text-secondary tabular-nums">{formatClock(step.at)}</span>}
        </li>
      ))}
    </ol>
  );
}

/** Takes an id, not a payment, so the drawer follows the store while a payment settles under it. */
export function PaymentDrawer({ paymentId, onClose }: { paymentId: string | null; onClose: () => void }) {
  const { payments } = useGateway();
  const [refunding, setRefunding] = useState(false);
  const payment = paymentId ? payments.find((item) => item.id === paymentId) : undefined;

  return (
    <>
      <Drawer isOpen={Boolean(payment)} onOpenChange={(open) => !open && onClose()} aria-label="Payment details">
        {payment && (
          <>
            <DrawerHeader title={formatUsd(payment.usd)} description={payment.sourceName} />
            <DrawerBody>
              <div className="flex flex-col gap-5 pb-4">
                <dl className="flex flex-col gap-3">
                  <Detail label="Status"><PaymentStatusChip status={payment.status} /></Detail>
                  <Detail label="Payment ID"><span dir="ltr">{payment.id}</span></Detail>
                  <Detail label="Customer paid">{formatToken(payment.payAmount, payment.payAsset)} on {ASSETS[payment.payAsset].chain}</Detail>
                  <Detail label="Route fee">{formatUsd(routeFee(payment))}</Detail>
                  <Detail label={payment.status === "settled" ? "You received" : "You receive"}>{formatToken(payment.receiveAmount, payment.receiveAsset)}</Detail>
                  <Detail label="Settlement">{payment.settleSeconds !== null ? `${payment.settleSeconds} seconds` : "Not settled"}</Detail>
                  <Detail label="Payer"><span dir="ltr" title={payment.payer}>{shortAddress(payment.payer)}</span></Detail>
                  <Detail label="Date">{formatStamp(payment.createdAt)}</Detail>
                </dl>
                <section className="flex flex-col gap-3 border-t border-separator-border pt-4">
                  <h3 className="text-body-semibold">Timeline</h3>
                  <Timeline steps={paymentTimeline(payment)} />
                </section>
              </div>
            </DrawerBody>
            <DrawerFooter>
              <CopyButton text={payment.id} label="Payment ID">Copy ID</CopyButton>
              {payment.status === "settled" && <Button variant="secondary" leadingIcon={RiArrowGoBackLine} onClick={() => setRefunding(true)}>Mark refunded</Button>}
            </DrawerFooter>
          </>
        )}
      </Drawer>
      <AlertDialog
        isOpen={refunding}
        onOpenChange={setRefunding}
        title="Mark this payment as refunded?"
        description="It leaves your settled volume. No funds move in this demo."
        confirmLabel="Mark refunded"
        onConfirm={() => {
          if (payment) actions.refundPayments([payment.id]);
          setRefunding(false);
          toast.success("Payment marked as refunded");
        }}
      />
    </>
  );
}
