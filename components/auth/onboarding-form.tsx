"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { Input } from "@/components/base/input/input";
import { Select, SelectItem } from "@/components/base/select/select";
import { api, errorMessage } from "@/lib/api";
import { RECEIVE_ASSETS } from "@/lib/assets";
import type { AssetSymbol } from "@/lib/types";
import { AuthCard } from "./auth-card";

export function OnboardingForm() {
  const [name, setName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [receiveAsset, setReceiveAsset] = useState<AssetSymbol>("USDC");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/onboarding", { body: { name, businessName, receiveAsset, acceptTerms: accepted } });
      window.location.assign("/dashboard");
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Set up your workspace" description="You'll connect the wallet your funds settle to next.">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
        <Input label="Your name" autoComplete="name" value={name} onChange={setName} />
        <Input label="Business name" hint="Shown to customers at checkout." isRequired value={businessName} onChange={setBusinessName} />
        <Select label="Get paid in" selectedKey={receiveAsset} onSelectionChange={(key) => setReceiveAsset(key as AssetSymbol)} className="w-full" triggerClassName="w-full">
          {RECEIVE_ASSETS.map((asset) => <SelectItem key={asset.symbol} id={asset.symbol} textValue={asset.symbol}>{asset.symbol} on {asset.chain}</SelectItem>)}
        </Select>
        <Checkbox isSelected={accepted} onChange={setAccepted}>
          <span className="text-body-regular">I accept the <a href="/terms" target="_blank" className="underline">Merchant Terms</a>. My business is responsible for its own KYC, AML, licences and any regulatory audit.</span>
        </Checkbox>
        {error && <p role="alert" className="text-body-regular text-text-error-primary">{error}</p>}
        <Button type="submit" disabled={busy || !businessName.trim() || !accepted}>{busy ? "Setting up" : "Continue"}</Button>
      </form>
    </AuthCard>
  );
}
