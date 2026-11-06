"use client";

import { useState, type ReactNode } from "react";
import { RiFileCopyLine, RiShieldCheckLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/base/modal/modal";
import { NumberField } from "@/components/base/number-field/number-field";
import { Switch } from "@/components/base/switch/switch";
import { toast } from "@/components/base/toast/toast";
import { api, errorMessage } from "@/lib/api";
import { ASSETS } from "@/lib/assets";
import { formatToken } from "@/lib/format";
import { baseToDecimal, decimalToBase } from "@/lib/money";
import { signTransfer, type PreparedTransfer } from "@/lib/sign-intent";
import { refresh, useGateway } from "@/lib/store";
import type { AssetSymbol, Payment } from "@/lib/types";
import { connectWallet, sendDeposit } from "@/lib/wallet";
import { copyText } from "./ui";

type Prepared =
  | (PreparedTransfer & { id: string; kind: "intent"; asset: AssetSymbol; payAsset: AssetSymbol; payBase: string; minPayBase: string; recipient: string })
  | { id: string; kind: "route"; asset: AssetSymbol; amountBase: string; amount: string; chain: string; payAsset: AssetSymbol; payBase: string; minPayBase: string; recipient: string; depositAddress: string; depositMemo: string | null };

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-body-regular text-text-secondary">{label}</dt>
      <dd className="min-w-0 text-end text-body-medium tabular-nums [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

const units = (base: string, asset: AssetSymbol) => baseToDecimal(base, ASSETS[asset].tokenDecimals);

/**
 * The money goes back to the wallet the customer gave at checkout, in the asset and on the chain they
 * paid with. The server takes that from the payment and never from this form.
 */
function Form({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const { mode, settlement } = useGateway();
  const refundedUsd = payment.detail?.refundedUsd ?? 0;
  const ratio = payment.usd > 0 ? 1 - refundedUsd / payment.usd : 1;
  const remaining = payment.receiveAmount * ratio;
  const [whole, setWhole] = useState(true);
  const [amount, setAmount] = useState(remaining);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [busy, setBusy] = useState(false);
  const decimals = ASSETS[payment.receiveAsset].tokenDecimals;

  const prepare = async () => {
    setBusy(true);
    try {
      const amountBase = whole ? undefined : decimalToBase(amount.toFixed(Math.min(decimals, 8)), decimals).toString();
      setPrepared(await api<Prepared>("/api/refunds", { body: { paymentId: payment.id, amountBase } }));
    } catch (error) {
      toast.error("Couldn't prepare this refund", { description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const signAndSend = async () => {
    if (prepared?.kind !== "intent") return;
    setBusy(true);
    try {
      const signature = await signTransfer(prepared, { recipient: prepared.recipient, mode });
      await api(`/api/refunds/${prepared.id}/sign`, { body: { signature } });
      await refresh();
      toast.success("Refund on its way", { description: "You'll get a notification when it lands." });
      onClose();
    } catch (error) {
      toast.error("Refund not sent", { description: errorMessage(error) });
      setBusy(false);
    }
  };

  const sendFromWallet = async () => {
    if (prepared?.kind !== "route") return;
    setBusy(true);
    try {
      const from = await connectWallet();
      if (settlement.wallet && from !== settlement.wallet) throw new Error(`Switch your wallet to ${settlement.wallet}, which received this payment.`);
      await sendDeposit({ asset: ASSETS[prepared.asset], to: prepared.depositAddress, amountBase: prepared.amountBase, from });
      await refresh();
      toast.success("Refund sent", { description: "It updates here once the route sees it." });
      onClose();
    } catch (error) {
      toast.error("Refund not sent", { description: errorMessage(error) });
      setBusy(false);
    }
  };

  if (prepared) {
    const leaves = prepared.kind === "route" ? prepared.amountBase : prepared.amountBase;
    return (
      <>
        <ModalHeader title={prepared.kind === "intent" ? "Check and sign" : "Send the refund"} description={prepared.kind === "intent" ? "Your wallet signs this. Gateway can't send it without you." : `Send from your wallet on ${prepared.chain}. The route delivers it to the customer in the asset they paid with.`} />
        <ModalBody className="flex flex-col gap-4 pb-1">
          <dl className="dash-well flex flex-col gap-1.5 rounded-xl p-3">
            <Row label="You send">{units(leaves, prepared.asset)} {prepared.asset}{prepared.kind === "route" ? ` on ${prepared.chain}` : ""}</Row>
            <Row label="Customer receives about">{units(prepared.payBase, prepared.payAsset)} {prepared.payAsset} on {ASSETS[prepared.payAsset].chain}</Row>
            <Row label="At least">{units(prepared.minPayBase, prepared.payAsset)} {prepared.payAsset}</Row>
            <Row label="Customer's wallet"><span dir="ltr">{prepared.recipient}</span></Row>
            {prepared.kind === "route" && <Row label="Send to"><span dir="ltr">{prepared.depositAddress}</span></Row>}
            {prepared.kind === "route" && prepared.depositMemo && <Row label="Memo, required"><span dir="ltr">{prepared.depositMemo}</span></Row>}
          </dl>
          <p className="flex items-start gap-1.5 text-caption-1-regular text-text-secondary">
            <RiShieldCheckLine className="mt-px size-4 shrink-0" aria-hidden />
            {prepared.kind === "intent" ? "Your wallet shows a transfer to a one-time routing address. This browser has checked the route's signature proves it pays the customer's wallet above." : `Send exactly this asset on ${prepared.chain}. Anything else may be lost.`}
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          {prepared.kind === "route" && <Button variant="secondary" leadingIcon={RiFileCopyLine} onClick={() => void copyText(prepared.depositAddress, "Address")}>Copy address</Button>}
          {prepared.kind === "intent" ? <Button disabled={busy} onClick={() => void signAndSend()}>{busy ? "Waiting for wallet" : "Sign in wallet"}</Button> : <Button disabled={busy} onClick={() => void sendFromWallet()}>{busy ? "Waiting for wallet" : "Send from wallet"}</Button>}
        </ModalFooter>
      </>
    );
  }

  return (
    <>
      <ModalHeader title="Refund this payment" description={`Up to ${formatToken(remaining, payment.receiveAsset)}. It goes back to the wallet the customer paid from, in ${payment.payAsset}.`} />
      <ModalBody className="flex flex-col gap-4 pb-1">
        <Switch size="sm" isSelected={whole} onChange={setWhole}>Refund everything left</Switch>
        {!whole && <NumberField label={`Amount in ${payment.receiveAsset}`} value={amount} onChange={setAmount} minValue={0} maxValue={remaining} isInvalid={amount > remaining} formatOptions={{ maximumFractionDigits: Math.min(decimals, 8) }} />}
        <p className="text-caption-1-regular text-text-secondary">{mode === "live" ? "Network and route fees come out of what the customer receives. A refund can't be undone." : "Test mode. No funds move."}</p>
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button disabled={busy || (!whole && (!(amount > 0) || amount > remaining))} onClick={() => void prepare()}>{busy ? "Getting a price" : "Continue"}</Button>
      </ModalFooter>
    </>
  );
}

export function RefundDialog({ payment, onClose }: { payment: Payment | null; onClose: () => void }) {
  return (
    <Modal isOpen={Boolean(payment)} onOpenChange={(open) => !open && onClose()} size="md" aria-label="Refund this payment">
      {payment && <Form key={payment.id} payment={payment} onClose={onClose} />}
    </Modal>
  );
}
