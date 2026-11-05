"use client";

import { useState, type FormEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { getLocalTimeZone, today, type CalendarDate } from "@internationalized/date";
import { RiAddLine, RiCheckLine, RiExternalLinkLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { DatePicker } from "@/components/base/date-picker/date-picker";
import { Label } from "@/components/base/input/label";
import { Input } from "@/components/base/input/input";
import { NumberField } from "@/components/base/number-field/number-field";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { Textarea } from "@/components/base/textarea/textarea";
import { CheckoutWidget } from "@/components/checkout/checkout-widget";
import { NavButton } from "@/components/nav-button";
import { formatDate, formatUsd } from "@/lib/format";
import { actions, newId, useGateway } from "@/lib/store";
import type { AssetSymbol, PaymentLink } from "@/lib/types";
import { useOrigin } from "@/lib/use-origin";
import { AssetSelect } from "../asset-select";
import { CopyButton, PageHeader, Panel } from "../ui";

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function LinkNewView() {
  const { settings } = useGateway();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fixed, setFixed] = useState(true);
  const [amount, setAmount] = useState(250);
  const [receiveAsset, setReceiveAsset] = useState<AssetSymbol>(settings.receiveAsset);
  const [expiry, setExpiry] = useState<CalendarDate | null>(null);
  const [successUrl, setSuccessUrl] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [created, setCreated] = useState<PaymentLink | null>(null);

  const titleInvalid = submitted && !title.trim();
  const amountInvalid = submitted && fixed && !(amount > 0);
  const urlInvalid = submitted && successUrl !== "" && !isHttpsUrl(successUrl);
  const expiryInvalid = submitted && expiry !== null && expiry.compare(today(getLocalTimeZone())) <= 0;

  const reset = () => {
    setTitle("");
    setDescription("");
    setExpiry(null);
    setSuccessUrl("");
    setSubmitted(false);
    setCreated(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    const valid =
      title.trim() !== "" &&
      (!fixed || amount > 0) &&
      (successUrl === "" || isHttpsUrl(successUrl)) &&
      (expiry === null || expiry.compare(today(getLocalTimeZone())) > 0);
    if (!valid) return;
    const link: PaymentLink = {
      id: newId("lnk_"),
      title: title.trim(),
      description: description.trim(),
      amount: fixed ? amount : null,
      receiveAsset,
      status: "active",
      expiresAt: expiry ? `${expiry.toString()}T00:00:00.000Z` : null,
      successUrl,
      createdAt: new Date().toISOString(),
    };
    actions.addLink(link);
    setCreated(link);
  };

  if (created) return <LinkCreated link={created} onAnother={reset} />;

  return (
    <>
      <PageHeader title="New payment link" description="Set what you're charging and which asset you want to receive." />
      <div className="grid grid-cols-12 items-start gap-3 @3xl:gap-4">
        <Panel className="col-span-12 @4xl:col-span-7">
          <form onSubmit={submit} noValidate className="flex flex-col gap-5">
            <Input label="Title" placeholder="Brand sprint deposit" value={title} onChange={setTitle} isRequired isInvalid={titleInvalid} errorMessage="Give the link a title." hint="Customers see this at checkout." />
            <Textarea label="Description" placeholder="What is this payment for?" value={description} onChange={setDescription} rows={2} />

            <div className="flex flex-col gap-2">
              <Label>Amount</Label>
              <SegmentedControl
                aria-label="Amount type"
                selectedKeys={[fixed ? "fixed" : "open"]}
                onSelectionChange={(keys) => setFixed(keys.has("fixed"))}
                className="self-start"
              >
                <SegmentedControlItem id="fixed">Fixed amount</SegmentedControlItem>
                <SegmentedControlItem id="open">Customer sets</SegmentedControlItem>
              </SegmentedControl>
              {fixed && (
                <>
                  <NumberField aria-label="Amount in USD" value={amount} onChange={setAmount} minValue={1} formatOptions={{ style: "currency", currency: "USD" }} isInvalid={amountInvalid} />
                  {amountInvalid && <p className="text-caption-1-regular text-text-error-primary">Enter an amount above zero.</p>}
                </>
              )}
            </div>

            <AssetSelect label="Receive as" value={receiveAsset} onChange={setReceiveAsset} />

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label>Expires (optional)</Label>
                <DatePicker aria-label="Expiry date" value={expiry} onChange={setExpiry} />
                {expiryInvalid && <p className="text-caption-1-regular text-text-error-primary">Pick a date in the future.</p>}
              </div>
              <Input label="Success URL (optional)" placeholder="https://yoursite.com/thanks" type="url" value={successUrl} onChange={setSuccessUrl} isInvalid={urlInvalid} errorMessage="Enter a full https:// URL." />
            </div>

            <div className="flex justify-end gap-2">
              <NavButton href="/dashboard/links" variant="secondary">Cancel</NavButton>
              <Button type="submit" leadingIcon={RiAddLine}>Create link</Button>
            </div>
          </form>
        </Panel>

        <div className="col-span-12 flex min-w-0 justify-center rounded-3xl border border-border-button-default bg-background-inner-default p-5 @4xl:sticky @4xl:top-6 @4xl:col-span-5">
          <CheckoutWidget
            merchant={settings.businessName}
            title={title || "Your link title"}
            description={description}
            amount={fixed ? amount || 0 : null}
            receiveAsset={receiveAsset}
            isDisabled
            disabledMessage="Preview only"
          />
        </div>
      </div>
    </>
  );
}

function LinkCreated({ link, onAnother }: { link: PaymentLink; onAnother: () => void }) {
  const origin = useOrigin();
  const url = `${origin}/pay/${link.id}`;
  return (
    <>
      <PageHeader title="Your link is live" description="Share it anywhere. Payments show up in your dashboard as they settle." />
      <div className="grid grid-cols-12 gap-3 @3xl:gap-4">
      <Panel className="col-span-12 justify-center @3xl:col-span-7">
        <span className="flex size-12 items-center justify-center rounded-full bg-status-lime-background text-status-lime-text">
          <RiCheckLine className="size-6" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-title-2-semibold [overflow-wrap:anywhere]">{link.title}</h2>
          <p className="text-body-regular text-text-secondary">
            {link.amount === null ? "Customer sets the amount" : formatUsd(link.amount)}, received in {link.receiveAsset}
            {link.expiresAt ? `, expires ${formatDate(link.expiresAt)}` : ""}
          </p>
        </div>
        <div dir="ltr" className="w-full truncate rounded-xl bg-background-secondary-default px-3 py-2 text-body-medium">{url}</div>
        <div className="flex flex-wrap gap-2">
          <CopyButton text={url} label="Link" variant="primary">Copy link</CopyButton>
          <NavButton href={`/pay/${link.id}`} variant="secondary" leadingIcon={RiExternalLinkLine}>Open checkout</NavButton>
          <Button variant="ghost" onClick={onAnother}>Create another</Button>
        </div>
      </Panel>
      <Panel className="col-span-12 items-center justify-center @3xl:col-span-5">
        {/* A QR code needs a light ground to scan, whatever the theme. */}
        <div className="theme-scope-light rounded-2xl border border-border-button-default bg-background-primary-default p-4 text-text-primary">
          <QRCodeSVG value={url} size={184} bgColor="transparent" fgColor="currentColor" title={`QR code for ${url}`} />
        </div>
      </Panel>
      </div>
    </>
  );
}
