"use client";

import { useState } from "react";
import { RiShieldCheckLine, RiWalletLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/base/modal/modal";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { toast } from "@/components/base/toast/toast";
import { api, errorMessage } from "@/lib/api";
import { refresh, useGateway } from "@/lib/store";
import type { SettlementMode } from "@/lib/types";
import { signChallenge } from "@/lib/sign-intent";
import { connectWallet } from "@/lib/wallet";
import { Panel } from "./ui";

/** One step per wallet: a browser wallet signs with whichever account is selected, so the person switches between them. */
function ChangeWallet({ current, isOpen, onClose }: { current: string | null; isOpen: boolean; onClose: () => void }) {
  const [step, setStep] = useState<"new" | "current">("new");
  const [draft, setDraft] = useState<{ wallet: string; message: string; newSignature: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => { setStep("new"); setDraft(null); setBusy(false); onClose(); };

  const save = async (body: { wallet: string; message: string; newSignature: string; currentSignature?: string }) => {
    await api("/api/wallet", { body });
    await refresh();
    toast.success("Settlement wallet connected", { description: "New payments go to this wallet. Your team has been told." });
    close();
  };

  const signNew = async () => {
    setBusy(true);
    try {
      const wallet = await connectWallet();
      if (wallet === current) throw new Error("That's already your settlement wallet. Select the new account in your wallet.");
      const { message } = await api<{ message: string }>("/api/wallet/challenge", { body: { action: "settlement", address: wallet } });
      const newSignature = await signChallenge(wallet, message, "settlement", wallet);
      if (current) {
        setDraft({ wallet, message, newSignature });
        setStep("current");
      } else {
        await save({ wallet, message, newSignature });
      }
    } catch (error) {
      toast.error("Wallet not connected", { description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  const signCurrent = async () => {
    if (!draft || !current) return;
    setBusy(true);
    try {
      const account = await connectWallet();
      if (account !== current) throw new Error(`Select ${current} in your wallet to confirm this change.`);
      await save({ ...draft, currentSignature: await signChallenge(account, draft.message, "settlement", draft.wallet) });
    } catch (error) {
      toast.error("Wallet not changed", { description: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && close()} size="sm" aria-label="Settlement wallet">
      {step === "new" ? (
        <>
          <ModalHeader title={current ? "Change settlement wallet" : "Connect your settlement wallet"} description="Payments settle to this wallet, and only this wallet can move them. Gateway never holds its key." />
          <ModalBody className="flex flex-col gap-3 pb-1">
            <p className="flex items-start gap-1.5 text-body-regular text-text-secondary"><RiShieldCheckLine className="mt-0.5 size-4 shrink-0" aria-hidden />Use a regular wallet account you control, not a smart-contract wallet or an exchange address. Signing costs nothing and moves no funds.</p>
            {current && <p className="text-body-regular text-text-secondary">Your current wallet must approve this too, and its balance must be paid out first. If you&apos;ve lost access to it, contact support.</p>}
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button disabled={busy} leadingIcon={RiWalletLine} onClick={() => void signNew()}>{busy ? "Waiting for wallet" : "Connect and sign"}</Button>
          </ModalFooter>
        </>
      ) : (
        <>
          <ModalHeader title="Confirm with your current wallet" description="Switch to your current wallet account, then sign the same message." />
          <ModalBody className="flex flex-col gap-2 pb-1">
            <p className="text-body-regular">Current: <span dir="ltr" className="[overflow-wrap:anywhere]">{current}</span></p>
            <p className="text-body-regular">New: <span dir="ltr" className="[overflow-wrap:anywhere]">{draft?.wallet}</span></p>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={close}>Cancel</Button>
            <Button disabled={busy} onClick={() => void signCurrent()}>{busy ? "Waiting for wallet" : "Sign with current wallet"}</Button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
}

export function SettlementCard() {
  const { settlement, me } = useGateway();
  const [changing, setChanging] = useState(false);
  const isOwner = me?.role === "owner";

  const setMode = async (mode: SettlementMode) => {
    try {
      await api("/api/settings", { method: "PATCH", body: { settlementMode: mode } });
      await refresh();
      toast.success(mode === "balance" ? "Payments now settle to your balance" : "Payments now go straight to your wallet", { id: "settlement-mode" });
    } catch (error) {
      toast.error("That didn't save", { description: errorMessage(error) });
    }
  };

  return (
    <Panel title="Settlement" description="Where your money lands. Gateway never holds it." className="col-span-12" actions={isOwner ? <Button variant="secondary" size="small" leadingIcon={RiWalletLine} onClick={() => setChanging(true)}>{settlement.wallet ? "Change wallet" : "Connect wallet"}</Button> : undefined}>
      <div className="dash-well flex flex-col gap-0.5 rounded-xl p-2.5">
        <span className="text-caption-1-regular text-text-secondary">Settlement wallet</span>
        <span dir="ltr" className="text-start text-body-medium [overflow-wrap:anywhere]">{settlement.wallet ?? "Not connected. Checkout stays closed until you connect one."}</span>
      </div>
      <div className="flex flex-col gap-2">
        <SegmentedControl aria-label="How funds settle" isDisabled={!isOwner} selectedKeys={[settlement.mode]} onSelectionChange={(keys) => { const value = [...keys][0]; if (value && value !== settlement.mode) void setMode(value as SettlementMode); }} className="self-start">
          <SegmentedControlItem id="balance">Settlement balance</SegmentedControlItem>
          <SegmentedControlItem id="direct">Straight to wallet</SegmentedControlItem>
        </SegmentedControl>
        <p className="text-caption-1-regular text-text-secondary">
          {settlement.mode === "balance"
            ? "Payments collect in a NEAR Intents balance only your wallet controls. You sign payouts when you want them, in any asset, on any chain. Funds there depend on NEAR Intents staying available."
            : "Each payment goes to your wallet as it settles, with nothing left in NEAR Intents. Only assets on EVM chains can settle this way, and there's no payout step or refund window."}
        </p>
      </div>
      <ChangeWallet current={settlement.wallet} isOpen={changing} onClose={() => setChanging(false)} />
    </Panel>
  );
}
