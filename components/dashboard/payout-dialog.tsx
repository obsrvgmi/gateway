"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Radio as AriaRadio, RadioGroup as AriaRadioGroup } from "react-aria-components";
import { RiCheckLine, RiInformationLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Label } from "@/components/base/input/label";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/base/modal/modal";
import { NumberField } from "@/components/base/number-field/number-field";
import { Select, SelectItem } from "@/components/base/select/select";
import { Spinner } from "@/components/base/spinner/spinner";
import { Rosette } from "@/components/brand/rosette";
import { TokenMark } from "@/components/brand/token-mark";
import { ASSETS } from "@/lib/assets";
import { formatToken, formatUsd, shortAddress } from "@/lib/format";
import { metricsNow } from "@/lib/metrics";
import { ledger, payoutFee } from "@/lib/payouts";
import { actions, newId, useGateway } from "@/lib/store";
import type { AssetSymbol, Payout } from "@/lib/types";
import { cx } from "@/utils/cx";
import { AssetSelect } from "./asset-select";
import { PAYOUT_STEPS, runPayout, watchPayout } from "./payout-sim";

function Row({ label, children, strong = false }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-body-regular text-text-secondary">{label}</dt>
      <dd className={cx("min-w-0 text-end tabular-nums [overflow-wrap:anywhere]", strong ? "text-body-semibold" : "text-body-regular")}>{children}</dd>
    </div>
  );
}

function Sending({ step, payout, onClose }: { step: number; payout: Payout; onClose: () => void }) {
  const done = step >= PAYOUT_STEPS.length;
  return (
    <>
      <ModalHeader title={done ? "Payout sent" : "Sending payout"} description={done ? "Simulated. No funds moved." : `${formatToken(payout.amount, payout.asset)} to ${payout.destinationLabel}`} />
      <ModalBody className="flex flex-col gap-4 pb-1">
        {done ? (
          <div role="status" className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center text-text-accent motion-safe:animate-[seal-in_700ms_cubic-bezier(0.16,1,0.3,1)_both]">
              <Rosette className="absolute inset-0" rings={4} petals={12} strokeWidth={0.6} />
              <span className="relative flex size-7 items-center justify-center rounded-full bg-accent-500 text-text-on-accent"><RiCheckLine className="size-5" aria-hidden /></span>
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-title-3-semibold tabular-nums">{formatToken(payout.receiveAmount, payout.receiveAsset)}</p>
              <p className="truncate text-body-regular text-text-secondary">{payout.destinationLabel}, <span dir="ltr">{shortAddress(payout.destinationAddress)}</span></p>
            </div>
          </div>
        ) : (
          <ol className="flex flex-col" aria-live="polite">
            {PAYOUT_STEPS.map((item, index) => (
              <li key={item.label} className={cx("flex items-center gap-3 py-1 text-body-medium", index > step && "text-text-tertiary")}>
                <span className="flex size-6 shrink-0 items-center justify-center">
                  {index < step ? <RiCheckLine className="size-5 text-text-accent" aria-hidden /> : index === step ? <Spinner size="sm" className="text-text-accent" /> : <span className="size-2 rounded-full bg-background-tertiary-default" />}
                </span>
                {item.label}
              </li>
            ))}
          </ol>
        )}
      </ModalBody>
      <ModalFooter>
        <Button onClick={onClose} variant={done ? "primary" : "secondary"}>{done ? "Done" : "Hide, keep sending"}</Button>
      </ModalFooter>
    </>
  );
}

function Form({ onClose }: { onClose: () => void }) {
  const { payments, payouts, settings } = useGateway();
  const { destinations, defaultDestinationId, holdDays } = settings.payouts;
  const position = useMemo(() => ledger(payments, payouts, holdDays, metricsNow(payments)), [payments, payouts, holdDays]);
  const [asset, setAsset] = useState<AssetSymbol | undefined>(position.available[0]?.asset);
  const balance = position.available.find((entry) => entry.asset === asset);
  const [amount, setAmount] = useState(balance?.amount ?? 0);
  const [receiveAsset, setReceiveAsset] = useState<AssetSymbol>(asset ?? settings.receiveAsset);
  const [destinationId, setDestinationId] = useState(defaultDestinationId);
  const [sent, setSent] = useState<Payout | null>(null);
  const [step, setStep] = useState(0);

  useEffect(() => () => watchPayout(null), []);

  useEffect(() => {
    if (!sent || step >= PAYOUT_STEPS.length) return;
    const timer = window.setTimeout(() => setStep(step + 1), PAYOUT_STEPS[step].ms);
    return () => window.clearTimeout(timer);
  }, [sent, step]);

  if (sent) return <Sending step={step} payout={sent} onClose={onClose} />;
  if (!balance || !asset) {
    return (
      <>
        <ModalHeader title="Nothing to pay out yet" description="Funds become available once they clear your refund window." />
        <ModalFooter><Button onClick={onClose}>Close</Button></ModalFooter>
      </>
    );
  }

  const price = ASSETS[asset].usd;
  const usd = (Number.isFinite(amount) ? amount : 0) * price;
  const fee = payoutFee(asset, receiveAsset, usd);
  const receiveAmount = Math.max(0, (usd - fee) / ASSETS[receiveAsset].usd);
  const destination = destinations.find((item) => item.id === destinationId) ?? destinations[0];
  const over = amount > balance.amount + 1e-9;
  const tooSmall = usd <= fee;
  const invalid = over || tooSmall;

  const pick = (next: AssetSymbol) => {
    setAsset(next);
    setReceiveAsset(next);
    setAmount(position.available.find((entry) => entry.asset === next)?.amount ?? 0);
  };

  const send = () => {
    if (invalid || !destination) return;
    const payout: Payout = {
      id: newId("pyt_"),
      asset,
      amount,
      receiveAsset,
      receiveAmount,
      usd,
      feeUsd: fee,
      destinationId: destination.id,
      destinationLabel: destination.label,
      destinationAddress: destination.address,
      status: "processing",
      trigger: "manual",
      paymentCount: 0,
      reference: newId("sim_", 12),
      createdAt: new Date().toISOString(),
      completedAt: null,
    };
    actions.addPayout(payout);
    watchPayout(payout.id);
    runPayout(payout.id);
    setSent(payout);
  };

  return (
    <>
      <ModalHeader title="Pay out now" description="Sweep your settlement account to a destination." />
      <ModalBody className="flex flex-col gap-4 pb-1">
        <AriaRadioGroup aria-label="Asset to pay out" value={asset} onChange={(value) => pick(value as AssetSymbol)} className="flex flex-col gap-1.5">
          <Label>From your balance</Label>
          {position.available.map((entry) => (
            <AriaRadio key={entry.asset} value={entry.asset} className={({ isSelected, isFocusVisible }) => cx("flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 outline-none transition-[background-color,box-shadow] duration-150", isSelected ? "bg-background-secondary-default shadow-[inset_0_0_0_1.5px_var(--viz-primary)]" : "shadow-[inset_0_0_0_1px_var(--color-border-button-default)] hover:bg-background-secondary-default", isFocusVisible && "ring-2 ring-border-focus-ring")}>
              <TokenMark symbol={entry.asset} size="sm" />
              <span className="min-w-0 flex-1 truncate text-body-medium tabular-nums">{formatToken(entry.amount, entry.asset)}</span>
              <span className="shrink-0 text-body-regular text-text-secondary tabular-nums">{formatUsd(entry.usd)}</span>
            </AriaRadio>
          ))}
        </AriaRadioGroup>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-end gap-2">
            <NumberField label={`Amount in ${asset}`} className="min-w-0 flex-1" value={amount} onChange={setAmount} minValue={0} isInvalid={invalid} formatOptions={{ maximumFractionDigits: ASSETS[asset].decimals }} />
            <Button variant="secondary" onClick={() => setAmount(balance.amount)} className="h-10">Max</Button>
          </div>
          {over && <p className="text-caption-1-regular text-text-error-primary">That&apos;s more than the {formatToken(balance.amount, asset)} available.</p>}
          {!over && tooSmall && <p className="text-caption-1-regular text-text-error-primary">Enter more than the {formatUsd(fee)} in fees.</p>}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <AssetSelect label="Receive as" value={receiveAsset} onChange={setReceiveAsset} />
          <Select label="Destination" selectedKey={destinationId} onSelectionChange={(key) => setDestinationId(String(key))} className="w-full" triggerClassName="w-full">
            {destinations.map((item) => <SelectItem key={item.id} id={item.id} textValue={item.label}>{item.label}</SelectItem>)}
          </Select>
        </div>

        <dl className="dash-well flex flex-col gap-1.5 rounded-xl p-3">
          <Row label="Leaves your balance">{formatToken(amount || 0, asset)}</Row>
          <Row label="Fees">{asset === receiveAsset ? formatUsd(fee) : `${formatUsd(fee)}, includes swap`}</Row>
          <Row label="To"><span dir="ltr">{destination ? shortAddress(destination.address) : "No destination"}</span></Row>
          <Row label="Destination receives" strong>{formatToken(receiveAmount, receiveAsset)}</Row>
        </dl>
        <p className="flex items-start gap-1.5 text-caption-1-regular text-text-secondary">
          <RiInformationLine className="mt-px size-4 shrink-0" aria-hidden />
          This is a demo. Your balance and history update, but no funds move and nothing reaches a wallet.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={invalid || !destination} onClick={send}>Send payout</Button>
      </ModalFooter>
    </>
  );
}

export function PayoutDialog({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="md" aria-label="Pay out now">
      {/* Mounted only while open, so each payout starts from the live balance. */}
      {isOpen && <Form onClose={() => onOpenChange(false)} />}
    </Modal>
  );
}
