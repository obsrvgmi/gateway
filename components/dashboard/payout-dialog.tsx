"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Radio as AriaRadio, RadioGroup as AriaRadioGroup } from "react-aria-components";
import { RiCheckLine, RiInformationLine, RiShieldCheckLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Label } from "@/components/base/input/label";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/base/modal/modal";
import { NumberField } from "@/components/base/number-field/number-field";
import { Select, SelectItem } from "@/components/base/select/select";
import { Spinner } from "@/components/base/spinner/spinner";
import { toast } from "@/components/base/toast/toast";
import { Rosette } from "@/components/brand/rosette";
import { TokenMark } from "@/components/brand/token-mark";
import { api, errorMessage, isRefusal } from "@/lib/api";
import { ASSETS } from "@/lib/assets";
import { payoutFailureText } from "@/lib/payouts";
import { formatToken, formatUsd, shortAddress } from "@/lib/format";
import { baseToDecimal, decimalToBase } from "@/lib/money";
import { signTransfer, type ExpectedMove, type PreparedTransfer, verifyTransferQuote } from "@/lib/sign-intent";
import { refresh, useGateway } from "@/lib/store";
import type { AssetSymbol, Payout } from "@/lib/types";
import { cx } from "@/utils/cx";
import { AssetSelect } from "./asset-select";
import { PayoutStatusChip } from "./ui";

interface PreparedPayout extends PreparedTransfer {
  id: string;
}

function Row({ label, children, strong = false }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-body-regular text-text-secondary">{label}</dt>
      <dd className={cx("min-w-0 text-end tabular-nums [overflow-wrap:anywhere]", strong ? "text-body-semibold" : "text-body-regular")}>{children}</dd>
    </div>
  );
}

const inUnits = (base: string, asset: AssetSymbol) => baseToDecimal(base, ASSETS[asset].tokenDecimals);

/** Follows the store, so the outcome appears when the provider reports it, not on a timer. */
function Sending({ payoutId, onClose }: { payoutId: string; onClose: () => void }) {
  const { payouts } = useGateway();
  const payout: Payout | undefined = payouts.find((item) => item.id === payoutId);
  const done = payout?.status === "sent";
  const failed = payout?.status === "failed";
  return (
    <>
      <ModalHeader title={done ? "Payout sent" : failed ? "Payout failed" : "Sending payout"} description={done ? undefined : failed ? "The funds stayed in your settlement account." : "You can close this. It keeps going, and you'll get a notification."} />
      <ModalBody className="flex flex-col gap-4 pb-1">
        {done && payout ? (
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
        ) : failed ? (
          <p className="rounded-xl bg-status-rose-background p-3 text-body-regular text-status-rose-text">{payout ? payoutFailureText(payout) : null}</p>
        ) : (
          <div role="status" className="flex items-center gap-3 text-body-medium"><Spinner size="sm" className="text-text-accent" />Routing through NEAR Intents {payout && <PayoutStatusChip status={payout.status} />}</div>
        )}
      </ModalBody>
      <ModalFooter><Button onClick={onClose} variant={done || failed ? "primary" : "secondary"}>{done || failed ? "Done" : "Hide, keep sending"}</Button></ModalFooter>
    </>
  );
}

/** The merchant checks the real quote here, and only their wallet can send it. */
function Review({ prepared, expected, label, onBack, onSent, onClose }: { prepared: PreparedPayout; expected: ExpectedMove; label: string; onBack: () => void; onSent: (id: string) => void; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  // From the signed quote and the merchant's own choices, not from the server's summary of them.
  const { amountOut, minAmountOut } = (prepared.quote as { quote: { amountOut: string; minAmountOut: string } }).quote;
  const sign = async () => {
    setBusy(true);
    let signature: string;
    try {
      signature = await signTransfer(prepared, expected);
    } catch (error) {
      toast.error("Payout not sent", { description: errorMessage(error) });
      setBusy(false);
      return;
    }
    try {
      await api(`/api/payouts/${prepared.id}/sign`, { body: { signature } });
    } catch (error) {
      if (isRefusal(error)) {
        toast.error("Payout not sent", { description: errorMessage(error) });
        setBusy(false);
        return;
      }
      // It's signed, and the answer was lost, so it may well be on its way. Starting another could pay twice.
      toast.error("We couldn't confirm this payout", { description: "It may have gone, so please don't start another. It shows here either way." });
    }
    await refresh().catch(() => undefined);
    onSent(prepared.id);
  };
  return (
    <>
      <ModalHeader title="Check and sign" description="Your wallet signs this. Gateway can't send it without you." />
      <ModalBody className="flex flex-col gap-4 pb-1">
        <dl className="dash-well flex flex-col gap-1.5 rounded-xl p-3">
          <Row label="Leaves your balance">{inUnits(expected.amountBase, expected.asset)} {expected.asset}</Row>
          <Row label="To">{label}</Row>
          <Row label="Address"><span dir="ltr">{expected.recipient}</span></Row>
          <Row label="Network">{ASSETS[expected.receiveAsset].chain}</Row>
          <Row label="Destination receives about" strong>{inUnits(amountOut, expected.receiveAsset)} {expected.receiveAsset}</Row>
          <Row label="At least">{inUnits(minAmountOut, expected.receiveAsset)} {expected.receiveAsset}</Row>
        </dl>
        <p className="flex items-start gap-1.5 text-caption-1-regular text-text-secondary">
          <RiShieldCheckLine className="mt-px size-4 shrink-0" aria-hidden />
          Your wallet shows a transfer to a one-time routing address, not this destination. This browser has checked the route&apos;s signature proves that address pays the destination above.
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" disabled={busy} onClick={onBack}>Back</Button>
        <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={() => void sign()}>{busy ? "Waiting for wallet" : "Sign in wallet"}</Button>
      </ModalFooter>
    </>
  );
}

function Form({ onClose }: { onClose: () => void }) {
  const { settings, settlement, mode } = useGateway();
  const { destinations, defaultDestinationId } = settings.payouts;
  const available = settlement.available;
  const [asset, setAsset] = useState<AssetSymbol | undefined>(available[0]?.asset);
  const balance = useMemo(() => available.find((entry) => entry.asset === asset), [available, asset]);
  const [amount, setAmount] = useState(balance?.amount ?? 0);
  const [useMax, setUseMax] = useState(true);
  const [receiveAsset, setReceiveAsset] = useState<AssetSymbol>(asset ?? settings.receiveAsset);
  const [destinationId, setDestinationId] = useState(defaultDestinationId);
  const [prepared, setPrepared] = useState<PreparedPayout | null>(null);
  const [chosen, setChosen] = useState<{ expected: ExpectedMove; label: string } | null>(null);
  const [sentId, setSentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (sentId) return <Sending payoutId={sentId} onClose={onClose} />;
  if (prepared && chosen) return <Review prepared={prepared} expected={chosen.expected} label={chosen.label} onBack={() => setPrepared(null)} onSent={setSentId} onClose={onClose} />;
  if (!settlement.wallet) {
    return (
      <>
        <ModalHeader title="Connect your settlement wallet" description="Only your own wallet can move your funds, so payouts need it connected. Do this in Settings." />
        <ModalFooter><Button onClick={onClose}>Close</Button></ModalFooter>
      </>
    );
  }
  if (!balance || !asset) {
    return (
      <>
        <ModalHeader title="Nothing to pay out yet" description={settlement.balancesFresh ? "Funds become available once they clear your refund window." : "We couldn't read your balance just now. Try again in a moment."} />
        <ModalFooter><Button onClick={onClose}>Close</Button></ModalFooter>
      </>
    );
  }

  const tokenDecimals = ASSETS[asset].tokenDecimals;
  /** Max uses the exact balance. A typed number goes through a string, so a float can't round it upward. */
  const amountBase = useMax ? balance.base : Number.isFinite(amount) && amount > 0 ? decimalToBase(amount.toFixed(Math.min(tokenDecimals, 8)), tokenDecimals).toString() : "0";
  const over = BigInt(amountBase) > BigInt(balance.base);
  const empty = amountBase === "0";
  const destination = destinations.find((item) => item.id === destinationId) ?? destinations[0];

  const pick = (next: AssetSymbol) => {
    setAsset(next);
    setReceiveAsset(next);
    setAmount(available.find((entry) => entry.asset === next)?.amount ?? 0);
    setUseMax(true);
  };

  const prepare = async () => {
    if (over || empty || !destination || !settlement.wallet) return;
    setBusy(true);
    try {
      // Fixed now, before anything comes back from the server.
      setChosen({ label: destination.label, expected: { signer: settlement.wallet, recipient: destination.address, asset, receiveAsset, amountBase } });
      const quoted = await api<PreparedPayout>("/api/payouts", { body: { asset, amountBase, receiveAsset, destinationId: destination.id } });
      // Before showing a figure from it.
      verifyTransferQuote(quoted, { signer: settlement.wallet, recipient: destination.address, asset, receiveAsset, amountBase });
      setPrepared(quoted);
    } catch (error) {
      toast.error("Couldn't prepare this payout", { description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ModalHeader title="Pay out now" description="Sweep your settlement account to a destination." />
      <ModalBody className="flex flex-col gap-4 pb-1">
        <AriaRadioGroup aria-label="Asset to pay out" value={asset} onChange={(value) => pick(value as AssetSymbol)} className="flex flex-col gap-1.5">
          <Label>From your balance</Label>
          {available.map((entry) => (
            <AriaRadio key={entry.asset} value={entry.asset} className={({ isSelected, isFocusVisible }) => cx("flex cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 outline-none transition-[background-color,box-shadow] duration-150", isSelected ? "bg-background-secondary-default shadow-[inset_0_0_0_1.5px_var(--viz-primary)]" : "shadow-[inset_0_0_0_1px_var(--color-border-button-default)] hover:bg-background-secondary-default", isFocusVisible && "ring-2 ring-border-focus-ring")}>
              <TokenMark symbol={entry.asset} size="sm" />
              <span className="min-w-0 flex-1 truncate text-body-medium tabular-nums">{formatToken(entry.amount, entry.asset)}</span>
              <span className="shrink-0 text-body-regular text-text-secondary tabular-nums">{formatUsd(entry.usd)}</span>
            </AriaRadio>
          ))}
        </AriaRadioGroup>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-end gap-2">
            <NumberField label={`Amount in ${asset}`} className="min-w-0 flex-1" value={amount} onChange={(value) => { setAmount(value); setUseMax(false); }} minValue={0} isInvalid={over} formatOptions={{ maximumFractionDigits: Math.min(tokenDecimals, 8) }} />
            <Button variant="secondary" onClick={() => { setAmount(balance.amount); setUseMax(true); }} className="h-10">Max</Button>
          </div>
          {over && <p className="text-caption-1-regular text-text-error-primary">That&apos;s more than the {formatToken(balance.amount, asset)} available.</p>}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <AssetSelect label="Receive as" value={receiveAsset} onChange={setReceiveAsset} />
          <Select label="Destination" selectedKey={destinationId} onSelectionChange={(key) => setDestinationId(String(key))} className="w-full" triggerClassName="w-full">
            {destinations.map((item) => <SelectItem key={item.id} id={item.id} textValue={item.label}>{item.label}</SelectItem>)}
          </Select>
        </div>

        <p className="flex items-start gap-1.5 text-caption-1-regular text-text-secondary">
          <RiInformationLine className="mt-px size-4 shrink-0" aria-hidden />
          {mode === "live" ? "Next you'll see the live price and fees, then sign with your settlement wallet." : "Test mode. Next you'll see a test price, then sign with your wallet. No funds move."}
        </p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={over || empty || !destination || busy} onClick={() => void prepare()}>{busy ? "Getting a price" : "Continue"}</Button>
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
