"use client";

import { useEffect, useState, type ReactNode } from "react";
import { RiFileCopyLine, RiShieldCheckLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/base/modal/modal";
import { NumberField } from "@/components/base/number-field/number-field";
import { Switch } from "@/components/base/switch/switch";
import { toast } from "@/components/base/toast/toast";
import { api, errorMessage, isRefusal } from "@/lib/api";
import { ASSETS } from "@/lib/assets";
import { formatToken } from "@/lib/format";
import { baseToDecimal, decimalToBase } from "@/lib/money";
import { sendGuard, type SendRecord } from "@/lib/send-guard";
import { signTransfer, verifiedRouteAddress, verifyTransferQuote, type ExpectedMove, type PreparedTransfer } from "@/lib/sign-intent";
import { refresh, useGateway } from "@/lib/store";
import type { AssetSymbol, Payment } from "@/lib/types";
import { connectWallet, sendDeposit } from "@/lib/wallet";
import { copyText } from "./ui";

type Prepared =
  | (PreparedTransfer & { id: string; kind: "intent"; amountBase: string; signer: string })
  | { id: string; kind: "route"; amountBase: string; chain: string; depositTxHash: string | null; quote: unknown; quoteKey: string };

/** The parts of a quote the dialog shows. It reads them from the verified quote, not the server's summary of it. */
const quoted = (prepared: Prepared) => (prepared.quote as { quote: { amountOut: string; minAmountOut: string; depositAddress?: string; depositMemo?: string } }).quote;

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
  const refundedUsd = payment.detail?.refundedUsd ?? 0;
  const ratio = payment.usd > 0 ? 1 - refundedUsd / payment.usd : 1;
  const remaining = payment.receiveAmount * ratio;
  const [whole, setWhole] = useState(true);
  const [amount, setAmount] = useState(remaining);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [asked, setAsked] = useState<string | undefined>();
  const [record, setRecord] = useState<SendRecord>({ state: "none" });
  const [busy, setBusy] = useState(false);
  const decimals = ASSETS[payment.receiveAsset].tokenDecimals;
  const { mode, settlement } = useGateway();
  // Set from the payment on screen. The recipient and the assets can't come from the server's reply.
  const expectedFor = (signer: string, amountBase: string): ExpectedMove => ({ signer, recipient: payment.payer, asset: payment.receiveAsset, receiveAsset: payment.payAsset, amountBase });

  /**
   * Checks a reply before anything from it is shown. A route refund's failure comes back to the wallet named
   * in the quote, so that's the settlement wallet here, and the wallet that sends further down.
   */
  const verified = (reply: Prepared, amountBase: string | undefined) => {
    const tooMuch = amountBase ? reply.amountBase !== amountBase : Number(baseToDecimal(reply.amountBase, decimals)) > remaining * 1.001;
    if (tooMuch) throw new Error("The amount in this refund doesn't match what you asked for, so it wasn't shown.");
    if (reply.kind === "route") verifiedRouteAddress(reply, expectedFor(settlement.wallet ?? "", reply.amountBase));
    else verifyTransferQuote(reply, expectedFor(reply.signer, reply.amountBase));
    return reply;
  };

  const show = (reply: Prepared) => {
    setPrepared(reply);
    setRecord(reply.kind === "route" ? sendGuard(reply.id).read() : { state: "none" });
  };

  const prepare = async () => {
    setBusy(true);
    try {
      const amountBase = whole ? undefined : decimalToBase(amount.toFixed(Math.min(decimals, 8)), decimals).toString();
      setAsked(amountBase);
      show(verified(await api<Prepared>("/api/refunds", { body: { paymentId: payment.id, amountBase } }), amountBase));
    } catch (error) {
      toast.error("Couldn't prepare this refund", { description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const signAndSend = async () => {
    if (prepared?.kind !== "intent") return;
    setBusy(true);
    let signature: string;
    try {
      signature = await signTransfer(prepared, expectedFor(prepared.signer, prepared.amountBase));
    } catch (error) {
      toast.error("Refund not sent", { description: errorMessage(error) });
      setBusy(false);
      return;
    }
    try {
      const result = await api<{ state: string; failureReason: string | null }>(`/api/refunds/${prepared.id}/sign`, { body: { signature } });
      if (result.state === "failed") toast.error("Refund not sent", { description: result.failureReason ?? undefined });
      else toast.success("Refund on its way", { description: "You'll get a notification when it lands." });
    } catch (error) {
      if (isRefusal(error)) {
        toast.error("Refund not sent", { description: errorMessage(error) });
        setBusy(false);
        return;
      }
      // It's signed, and the answer was lost, so it may well be on its way. Starting another could pay twice.
      toast.error("We couldn't confirm this refund", { description: "It may have gone, so please don't start another. You'll get a notification either way." });
    }
    await refresh().catch(() => undefined);
    onClose();
  };

  const sendFromWallet = async () => {
    if (prepared?.kind !== "route") return;
    setBusy(true);
    const guard = sendGuard(prepared.id);
    try {
      const from = await connectWallet();
      // A failed route returns the funds to the wallet named in the quote, so it must be this one.
      const to = verifiedRouteAddress(prepared, expectedFor(from, prepared.amountBase));
      // This dialog may have sat open while another refund replaced this one.
      const current = verified(await api<Prepared>("/api/refunds", { body: { paymentId: payment.id, amountBase: asked ?? prepared.amountBase } }), asked ?? prepared.amountBase);
      if (current.id !== prepared.id) {
        show(current);
        toast.error("This refund changed", { description: "The address was replaced, so check the new details before sending." });
        setBusy(false);
        return;
      }
      guard.begin();
      const txHash = await sendDeposit({ asset: ASSETS[payment.receiveAsset], to, amountBase: prepared.amountBase, from }).catch((error: unknown) => {
        guard.clear();
        throw error;
      });
      guard.done(txHash);
      // Remembered at once, so opening this again can't offer a second send.
      await api(`/api/refunds/${prepared.id}/deposit`, { body: { txHash } }).catch(() => undefined);
      await refresh().catch(() => undefined);
      toast.success("Refund sent", { description: "It updates here once the route sees it." });
      onClose();
    } catch (error) {
      toast.error("Refund not sent", { description: errorMessage(error) });
      setBusy(false);
    }
  };

  /** A simulated address isn't one a wallet can send to, on purpose, so real funds can't go there. */
  const simulateSend = async () => {
    if (prepared?.kind !== "route") return;
    setBusy(true);
    try {
      await api(`/api/refunds/${prepared.id}/sim`, { method: "POST" });
      await refresh().catch(() => undefined);
      toast.success("Refund sent", { description: "Simulated. It updates here once the route sees it." });
      onClose();
    } catch (error) {
      toast.error("Refund not sent", { description: errorMessage(error) });
      setBusy(false);
    }
  };

  // Sent from this browser, and the server never heard: tell it now.
  const unreported = prepared?.kind === "route" && !prepared.depositTxHash && record.state === "sent" ? record.txHash : null;
  useEffect(() => {
    if (unreported && prepared) void api(`/api/refunds/${prepared.id}/deposit`, { body: { txHash: unreported } }).catch(() => undefined);
  }, [unreported, prepared]);

  if (prepared) {
    const alreadySent = prepared.kind === "route" && (Boolean(prepared.depositTxHash) || record.state === "sent");
    const maybeSent = prepared.kind === "route" && !alreadySent && record.state === "pending";
    const { amountOut, minAmountOut, depositAddress, depositMemo } = quoted(prepared);
    return (
      <>
        <ModalHeader title={prepared.kind === "intent" ? "Check and sign" : "Send the refund"} description={prepared.kind === "intent" ? "Your wallet signs this. Gateway can't send it without you." : `Send from your wallet on ${prepared.chain}. The route delivers it to the customer in the asset they paid with.`} />
        <ModalBody className="flex flex-col gap-4 pb-1">
          <dl className="dash-well flex flex-col gap-1.5 rounded-xl p-3">
            <Row label="You send">{units(prepared.amountBase, payment.receiveAsset)} {payment.receiveAsset}{prepared.kind === "route" ? ` on ${prepared.chain}` : ""}</Row>
            <Row label="Customer receives about">{units(amountOut, payment.payAsset)} {payment.payAsset} on {ASSETS[payment.payAsset].chain}</Row>
            <Row label="At least">{units(minAmountOut, payment.payAsset)} {payment.payAsset}</Row>
            <Row label="Customer's wallet"><span dir="ltr">{payment.payer}</span></Row>
            {prepared.kind === "route" && <Row label="Send to"><span dir="ltr">{depositAddress}</span></Row>}
            {prepared.kind === "route" && depositMemo && <Row label="Memo, required"><span dir="ltr">{depositMemo}</span></Row>}
            {prepared.kind === "route" && <Row label="If the route fails, it returns to"><span dir="ltr">{settlement.wallet}</span></Row>}
          </dl>
          <p className="flex items-start gap-1.5 text-caption-1-regular text-text-secondary">
            <RiShieldCheckLine className="mt-px size-4 shrink-0" aria-hidden />
            {prepared.kind === "intent" ? "Your wallet shows a transfer to a one-time routing address. This browser has checked the route's signature proves it pays the customer's wallet above." : alreadySent ? "You sent this. It updates here once the route sees it, so don't send it again." : maybeSent ? "You may have sent this already from this browser. Check your wallet's activity before sending it again." : `Send exactly this asset on ${prepared.chain}, once. Anything else may be lost. If you already sent it, don't send it again.`}
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          {prepared.kind === "route" && !alreadySent && <Button variant="secondary" leadingIcon={RiFileCopyLine} onClick={() => { try { void copyText(verifiedRouteAddress(prepared, expectedFor(settlement.wallet ?? "", prepared.amountBase)), "Address"); } catch (error) { toast.error("Address not copied", { description: errorMessage(error) }); } }}>Copy address</Button>}
          {prepared.kind === "intent" ? <Button disabled={busy} onClick={() => void signAndSend()}>{busy ? "Waiting for wallet" : "Sign in wallet"}</Button> : alreadySent ? <Button onClick={onClose}>Done</Button> : mode !== "live" ? <Button disabled={busy} onClick={() => void simulateSend()}>Simulate sending</Button> : <Button disabled={busy} onClick={() => void sendFromWallet()}>{busy ? "Waiting for wallet" : maybeSent ? "I checked, send from wallet" : "Send from wallet"}</Button>}
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
