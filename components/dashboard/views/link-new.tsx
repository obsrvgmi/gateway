"use client";

import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { getLocalTimeZone, parseDate, today, type CalendarDate } from "@internationalized/date";
import { RiAddLine, RiCheckLine, RiExternalLinkLine, RiLinkUnlinkM, RiSaveLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Label } from "@/components/base/input/label";
import { Input } from "@/components/base/input/input";
import { NumberField } from "@/components/base/number-field/number-field";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { SwitchCard } from "@/components/base/switch/switch-card";
import { Textarea } from "@/components/base/textarea/textarea";
import { toast } from "@/components/base/toast/toast";
import { CheckoutWidget } from "@/components/checkout/checkout-widget";
import { NavButton } from "@/components/nav-button";
import { formatDate, formatUsd } from "@/lib/format";
import { actions, newId, useGateway } from "@/lib/store";
import type { AssetSymbol, PaymentLink } from "@/lib/types";
import { useOrigin } from "@/lib/use-origin";
import { cx } from "@/utils/cx";
import { AssetSelect } from "../asset-select";
import { CopyButton, EmptyState, PageHeader, Panel, SimulatedTag } from "../ui";
import { useUnsavedGuard } from "../unsaved";

// Low on the form, and Motion's only other use: it loads with its box already held.
const DatePicker = dynamic(() => import("@/components/base/date-picker/date-picker").then((module) => module.DatePicker), { ssr: false, loading: () => <div aria-hidden className="h-10 rounded-xl bg-background-secondary-default" /> });
const QRCodeSVG = dynamic(() => import("qrcode.react").then((module) => module.QRCodeSVG), { ssr: false, loading: () => <div aria-hidden className="size-[184px]" /> });

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function LinkNewView() {
  return <LinkForm />;
}

export function LinkEditView() {
  const { id } = useParams<{ id: string }>();
  const { links } = useGateway();
  const link = links.find((item) => item.id === id);
  if (!link) {
    return (
      <>
        <PageHeader title="Edit link" />
        <Panel><EmptyState icon={RiLinkUnlinkM} title="This link doesn't exist" description="It may have been deleted." action={<NavButton href="/dashboard/links">Back to links</NavButton>} /></Panel>
      </>
    );
  }
  return <LinkForm key={link.id} existing={link} />;
}

function LinkForm({ existing }: { existing?: PaymentLink }) {
  const { settings } = useGateway();
  const router = useRouter();
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [fixed, setFixed] = useState(existing ? existing.amount !== null : true);
  const [amount, setAmount] = useState(existing?.amount ?? 250);
  const [receiveAsset, setReceiveAsset] = useState<AssetSymbol>(existing?.receiveAsset ?? settings.receiveAsset);
  const [expiry, setExpiry] = useState<CalendarDate | null>(existing?.expiresAt ? parseDate(existing.expiresAt.slice(0, 10)) : null);
  const [successUrl, setSuccessUrl] = useState(existing?.successUrl ?? "");
  const [singleUse, setSingleUse] = useState(existing?.singleUse ?? false);
  const [publicStats, setPublicStats] = useState(existing?.publicStats ?? false);
  const [submitted, setSubmitted] = useState(false);
  const [created, setCreated] = useState<PaymentLink | null>(null);
  // Two steps when creating. Editing shows everything at once, because someone came to change one thing.
  const [step, setStep] = useState<1 | 2>(1);
  const showDetails = Boolean(existing) || step === 1;
  const showOptions = Boolean(existing) || step === 2;
  const expiryValue = expiry?.toString() ?? null;
  const [baseline] = useState(() => JSON.stringify([title, description, fixed, amount, receiveAsset, expiryValue, successUrl, singleUse, publicStats]));
  const dirty = !created && JSON.stringify([title, description, fixed, amount, receiveAsset, expiryValue, successUrl, singleUse, publicStats]) !== baseline;
  const unsavedDialog = useUnsavedGuard(dirty);

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
    setStep(1);
  };

  const next = () => {
    setSubmitted(true);
    if (title.trim() === "" || (fixed && !(amount > 0))) return;
    setSubmitted(false);
    setStep(2);
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
    const fields = {
      title: title.trim(),
      description: description.trim(),
      amount: fixed ? amount : null,
      receiveAsset,
      expiresAt: expiry ? `${expiry.toString()}T00:00:00.000Z` : null,
      successUrl,
      singleUse,
      publicStats,
    };
    if (existing) {
      actions.updateLink(existing.id, fields);
      toast.success("Link saved");
      router.push("/dashboard/links");
      return;
    }
    const link: PaymentLink = { ...fields, metadata: {}, id: newId("lnk_"), status: "active", createdAt: new Date().toISOString() };
    actions.addLink(link);
    toast.success("Link created", { description: "It's ready to share." });
    setCreated(link);
  };

  if (created) return <LinkCreated link={created} onAnother={reset} />;

  return (
    <>
      <PageHeader title={existing ? `Edit ${existing.title}` : "New payment link"} description={existing ? "The URL stays the same. Changes apply to the next checkout." : "Set what you're charging and which asset you want to receive."} />
      <div className="grid grid-cols-12 items-start gap-3 @3xl:gap-4 @wide:grid-cols-[minmax(0,46rem)_minmax(0,1fr)]">
        <Panel className="col-span-12 @4xl:col-span-7 @wide:col-span-1">
          <form onSubmit={step === 1 && !existing ? (event) => { event.preventDefault(); next(); } : submit} noValidate className="flex flex-col gap-5">
            {!existing && (
              <ol className="flex items-center gap-2 text-caption-1-medium" aria-label="Steps">
                {["What you're charging", "How you're paid"].map((label, index) => (
                  <li key={label} aria-current={step === index + 1 ? "step" : undefined} className={cx("flex items-center gap-1.5", step === index + 1 ? "text-text-primary" : "text-text-tertiary")}>
                    <span className={cx("flex size-5 items-center justify-center rounded-full tabular-nums", step === index + 1 ? "bg-accent-500 text-text-on-accent" : "bg-background-secondary-default")}>{index + 1}</span>
                    {label}
                  </li>
                ))}
              </ol>
            )}
            {showDetails && <>
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

            </>}

            {showOptions && <>
            <AssetSelect label="Receive as" value={receiveAsset} onChange={setReceiveAsset} />

            <div className="grid gap-5 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label>Expires (optional)</Label>
                <DatePicker aria-label="Expiry date" value={expiry} onChange={setExpiry} />
                {expiryInvalid && <p className="text-caption-1-regular text-text-error-primary">Pick a date in the future.</p>}
              </div>
              <Input label="Success URL (optional)" placeholder="https://yoursite.com/thanks" type="url" value={successUrl} onChange={setSuccessUrl} isInvalid={urlInvalid} errorMessage="Enter a full https:// URL." hint="We add payment_id to it, so your page can look the payment up." />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <SwitchCard title="One payment only" description="Closes once a customer's payment arrives. Use it for a single order or invoice." isSelected={singleUse} onChange={setSingleUse} />
              <SwitchCard title="Show totals publicly" description="Anyone can read this link's total raised and payment count, for a counter on your site." isSelected={publicStats} onChange={setPublicStats} />
            </div>

            </>}

            <div className="flex justify-end gap-2">
              {step === 2 && !existing ? <Button variant="secondary" onClick={() => setStep(1)}>Back</Button> : <NavButton href="/dashboard/links" variant="secondary">Cancel</NavButton>}
              {existing ? <Button type="submit" leadingIcon={RiSaveLine}>Save changes</Button> : step === 1 ? <Button type="submit">Next</Button> : <Button type="submit" leadingIcon={RiAddLine}>Create link</Button>}
            </div>
          </form>
        </Panel>

        <div className="dash-plate dash-canvas col-span-12 flex min-w-0 flex-col items-center gap-3 rounded-3xl p-4 @4xl:sticky @4xl:top-[4.5rem] @4xl:col-span-5 @wide:col-span-1 @wide:min-h-[calc(100dvh-11.5rem)] @wide:justify-center">
          <SimulatedTag className="bg-background-inner-default">Preview, illustrative prices</SimulatedTag>
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
      {unsavedDialog}
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
        <div dir="ltr" className="dash-well w-full truncate rounded-xl px-3 py-2 text-body-medium">{url}</div>
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
