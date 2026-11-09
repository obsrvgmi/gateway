"use client";

import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Radio as AriaRadio, RadioGroup as AriaRadioGroup } from "react-aria-components";
import { RiAlertLine, RiCheckLine, RiErrorWarningLine, RiFileCopyLine, RiLock2Line, RiWalletLine } from "@remixicon/react";
import { Button, ButtonLink } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { NumberField } from "@/components/base/number-field/number-field";
import { Spinner } from "@/components/base/spinner/spinner";
import { Rosette } from "@/components/brand/rosette";
import { TokenMark } from "@/components/brand/token-mark";
import { addressError, isValidAddress } from "@/lib/address";
import { returnUrl } from "@/lib/return-url";
import { api, ApiError, errorMessage } from "@/lib/api";
import { sendGuard, type SendRecord } from "@/lib/send-guard";
import { ASSETS } from "@/lib/assets";
import { formatUsd, shortAddress } from "@/lib/format";
import type { AssetSymbol, PaymentsMode, WidgetRadius, WidgetSuccess, WidgetTheme } from "@/lib/types";
import { connectWallet, hasWallet, sendDeposit } from "@/lib/wallet";
import { cx } from "@/utils/cx";
import { accentStyle } from "./checkout-widget";

interface PayOption {
  symbol: AssetSymbol;
  name: string;
  chain: string;
  minimumUsd: number;
  paused: boolean;
}

export interface PublicSource {
  id: string;
  kind: "link" | "widget";
  merchant: string;
  title: string;
  description: string;
  amount: number | null;
  receiveAsset: AssetSymbol;
  accent: string;
  closedReason: string | null;
  options: PayOption[];
  mode: PaymentsMode;
  supportEmail: string;
  successUrl?: string;
  theme?: WidgetTheme;
  radius?: WidgetRadius;
  buttonLabel?: string;
  showBranding?: boolean;
  presets?: number[];
  logo?: string;
  collectEmail?: boolean;
  success?: WidgetSuccess;
}

interface Preview {
  payAmount: string;
  payUsd: number;
  feeUsd: number;
  receiveAmount: string;
  refundFee: string;
}

interface Session {
  id: string;
  state: string;
  status: string;
  live: boolean;
  payAsset: AssetSymbol;
  payChain: string;
  payBase: string | null;
  payAmount: string | null;
  minPayAmount: string | null;
  receiveAsset: AssetSymbol;
  receiveAmount: string;
  usd: number;
  feeUsd: number;
  depositAddress: string | null;
  depositMemo: string | null;
  payBy: string | null;
  deadline: string | null;
  refundAddress: string;
  depositSubmitted: boolean;
  deposited: string | null;
  returned: string | null;
  returnReason: string | null;
  originTxs: { hash: string; explorerUrl: string }[];
  destinationTxs: { hash: string; explorerUrl: string }[];
}

const RADIUS: Record<WidgetRadius, string> = { rounded: "rounded-3xl", soft: "rounded-2xl", sharp: "rounded-lg" };
const POLL_MS = 4_000;
const SEEN = new Set(["deposit_seen", "incomplete_deposit", "processing"]);

const storageKey = (sourceId: string) => `gateway:checkout:${sourceId}`;
const remember = (sourceId: string, sessionId: string | null) => {
  try {
    if (sessionId) window.localStorage.setItem(storageKey(sourceId), sessionId);
    else window.localStorage.removeItem(storageKey(sourceId));
  } catch {
    // Without storage, a reload starts over; the old address stays tracked on the server.
  }
};
const recall = (sourceId: string) => {
  try {
    return window.localStorage.getItem(storageKey(sourceId));
  } catch {
    return null;
  }
};

/**
 * Tells the merchant's page what happened: the page framing the widget, or the page that opened this
 * checkout with `Gateway.checkout()`. Carries nothing the customer's page couldn't see, which is why
 * any origin may hear it. Fulfilment still waits for a signed webhook.
 */
function tellParent(type: string, data: Record<string, unknown> = {}) {
  const message = { source: "gateway", type, ...data };
  if (window.parent !== window) window.parent.postMessage(message, "*");
  else if (window.opener && type !== "resize") (window.opener as Window).postMessage(message, "*");
}

function useCountdown(until: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [until]);
  if (!until) return null;
  const left = Math.max(0, new Date(until).getTime() - now);
  return { left, label: `${Math.floor(left / 60_000)}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, "0")}` };
}

function Copy({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="secondary"
      size="small"
      leadingIcon={copied ? RiCheckLine : RiFileCopyLine}
      aria-label={`Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          // The text is on screen to select by hand.
        }
      }}
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function Shell({ source, children }: { source: PublicSource; children: ReactNode }) {
  const theme = source.theme ?? "auto";
  return (
    <section
      aria-label={`Checkout for ${source.merchant}`}
      style={accentStyle(source.accent)}
      className={cx(theme === "light" && "theme-scope-light", theme === "dark" ? "dark bg-background-full" : "bg-background-inner-default", "stage-card flex w-full max-w-[420px] flex-col gap-4 border border-border-button-default p-5 text-text-primary shadow-lg", RADIUS[source.radius ?? "rounded"])}
    >
      <header className="flex items-center gap-3">
        {source.logo ? (
          // A small data URL the merchant uploaded, so there is nothing for next/image to optimise.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={source.logo} alt="" className="size-9 shrink-0 rounded-full object-cover" />
        ) : (
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-accent-500)_16%,transparent)] text-caption-1-semibold text-text-accent">{source.merchant.slice(0, 2).toUpperCase()}</span>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="truncate text-body-regular text-text-secondary">{source.merchant}</p>
          <h1 className="truncate text-body-semibold">{source.title}</h1>
        </div>
        {source.mode !== "live" && <span className="shrink-0 rounded-md border border-dashed border-border-button-hover px-1.5 py-0.5 text-caption-1-medium text-text-secondary">Test mode</span>}
      </header>
      {source.description && <p className="-mt-1 text-body-regular text-text-secondary">{source.description}</p>}
      {children}
      {source.showBranding !== false && (
        <footer className="flex items-center justify-center gap-1 text-caption-1-regular text-text-secondary">
          <RiLock2Line className="size-3.5" aria-hidden />
          Non-custodial, powered by NEAR Intents
        </footer>
      )}
    </section>
  );
}

function Line({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-body-regular text-text-secondary">{label}</dt>
      <dd className={cx("min-w-0 text-end tabular-nums [overflow-wrap:anywhere]", strong ? "text-body-semibold" : "text-body-regular")}>{value}</dd>
    </div>
  );
}

function Choose({ source, onSession }: { source: PublicSource; onSession: (session: Session) => void }) {
  const usable = useMemo(() => source.options.filter((option) => !option.paused), [source.options]);
  const [asset, setAsset] = useState<AssetSymbol | undefined>(usable[0]?.symbol);
  const [custom, setCustom] = useState(source.presets?.[0] ?? 50);
  const usd = source.amount ?? custom;
  const option = source.options.find((item) => item.symbol === asset);
  const belowMinimum = option ? usd < option.minimumUsd : false;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [wallet, setWallet] = useState("");
  const [walletInvalid, setWalletInvalid] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef(crypto.randomUUID());
  const kind = asset ? ASSETS[asset].addressKind : "evm";

  useEffect(() => {
    if (!asset || belowMinimum || !(usd > 0)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setPreview(null);
      setPreviewError(null);
      api<Preview>(`/api/checkout/${source.id}/preview`, { body: { payAsset: asset, amount: source.amount === null ? usd : undefined }, signal: controller.signal })
        .then(setPreview)
        .catch((failure: unknown) => {
          if (!controller.signal.aborted) setPreviewError(errorMessage(failure));
        });
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [asset, usd, belowMinimum, source.id, source.amount]);

  const fillFromWallet = async () => {
    try {
      setWallet(await connectWallet());
      setWalletInvalid(false);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const proceed = async () => {
    if (!asset) return;
    if (!isValidAddress(kind, wallet.trim())) {
      setWalletInvalid(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSession(await api<Session>(`/api/checkout/${source.id}/sessions`, { body: { payAsset: asset, amount: source.amount === null ? usd : undefined, refundAddress: wallet.trim(), email: email.trim() || undefined, idempotencyKey: attempt.current } }));
    } catch (failure) {
      // A definite refusal issued no address, so the next try is a fresh attempt. An outage might have.
      if (failure instanceof ApiError && failure.status < 500) attempt.current = crypto.randomUUID();
      setError(errorMessage(failure));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {source.amount === null ? (
        <div className="flex flex-col gap-2">
          <NumberField label="Amount" value={custom} onChange={setCustom} minValue={1} formatOptions={{ style: "currency", currency: "USD" }} />
          {Boolean(source.presets?.length) && (
            <div role="group" aria-label="Suggested amounts" className="flex flex-wrap gap-1.5">
              {source.presets?.map((preset) => (
                <button key={preset} type="button" aria-pressed={custom === preset} onClick={() => setCustom(preset)} className={cx("cursor-pointer rounded-lg px-2.5 py-1 text-body-medium tabular-nums outline-none transition-[background-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-border-focus-ring", custom === preset ? "bg-background-secondary-default shadow-[inset_0_0_0_1.5px_var(--color-accent-500)]" : "shadow-[inset_0_0_0_1px_var(--color-border-button-default)] hover:bg-background-primary-hover")}>
                  {formatUsd(preset).replace(".00", "")}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="text-[2.5rem] leading-none font-semibold tracking-[-0.035em] tabular-nums">{formatUsd(source.amount)}</p>
      )}

      {usable.length === 0 ? (
        <p role="alert" className="text-body-regular text-text-secondary">Payments are paused right now. Please try again later.</p>
      ) : (
        <AriaRadioGroup aria-label="Pay with" value={asset} onChange={(value) => { setAsset(value as AssetSymbol); setWallet(""); setWalletInvalid(false); setError(null); }} className="flex flex-col gap-2">
          <span className="text-body-medium text-text-secondary">Pay with</span>
          <div className="grid grid-cols-4 gap-1.5">
            {usable.map((item) => (
              <AriaRadio key={item.symbol} value={item.symbol} aria-label={`${item.name} on ${item.chain}`} className={({ isSelected, isFocusVisible }) => cx("flex cursor-pointer flex-col items-center gap-1 rounded-xl py-2 outline-none transition-[background-color,box-shadow] duration-150", isSelected ? "bg-background-secondary-default shadow-[inset_0_0_0_1.5px_var(--color-accent-500)]" : "shadow-[inset_0_0_0_1px_var(--color-border-button-default)] hover:bg-background-primary-hover", isFocusVisible && "ring-2 ring-border-focus-ring")}>
                <TokenMark symbol={item.symbol} size="sm" />
                <span className="text-caption-1-medium">{item.symbol}</span>
              </AriaRadio>
            ))}
          </div>
          {option && <p className="text-caption-1-regular text-text-secondary">On {option.chain}</p>}
        </AriaRadioGroup>
      )}

      {belowMinimum && option ? (
        <p role="alert" className="rounded-xl bg-background-secondary-default p-3 text-body-regular">{option.chain} payments must be at least {formatUsd(option.minimumUsd)}. Choose another asset.</p>
      ) : previewError ? (
        <p role="alert" className="rounded-xl bg-background-secondary-default p-3 text-body-regular">{previewError}</p>
      ) : (
        <dl className="flex flex-col gap-1.5" aria-live="polite">
          <Line label="You pay" value={preview ? `${preview.payAmount} ${asset}` : <span className="text-text-tertiary">Getting a price</span>} />
          <Line label="Route fee" value={preview ? formatUsd(preview.feeUsd) : " "} />
          <Line label={`${source.merchant} receives`} strong value={preview ? `${preview.receiveAmount} ${source.receiveAsset}` : " "} />
        </dl>
      )}

      {!belowMinimum && (
        <div className="flex flex-col gap-2">
          <div className="flex items-end gap-2">
            <Input className="min-w-0 flex-1" label={`Your ${asset ? ASSETS[asset].chain : ""} wallet`} inputDir="ltr" placeholder={kind === "evm" ? "0x…" : ""} value={wallet} onChange={(value) => { setWallet(value); setWalletInvalid(false); }} isInvalid={walletInvalid} errorMessage={addressError(kind)} hint="If this payment can't complete, your funds go back here." />
            {kind === "evm" && hasWallet() && <Button variant="secondary" leadingIcon={RiWalletLine} onClick={() => void fillFromWallet()} className="mb-6 h-10">Connect</Button>}
          </div>
          {source.collectEmail && <Input label="Email for your receipt" type="email" inputDir="ltr" placeholder="you@example.com" value={email} onChange={setEmail} />}
        </div>
      )}

      {error && <p role="alert" className="text-body-regular text-text-error-primary">{error}</p>}

      <div className="flex flex-col gap-2">
        <Button className="h-11 w-full rounded-xl" disabled={!preview || belowMinimum || busy || !wallet.trim()} onClick={() => void proceed()}>
          {busy ? "Preparing" : source.buttonLabel ?? "Continue to payment"}
        </Button>
        <p className="text-center text-caption-1-regular text-text-secondary">
          Crypto payments can&apos;t be reversed by us.{preview && Number(preview.refundFee) > 0 ? ` If this can't complete, your deposit returns less about ${preview.refundFee} ${asset} in network fees.` : ""} By paying you accept the <a href="/terms#customers" target="_blank" className="underline">customer terms</a>.
        </p>
      </div>
    </div>
  );
}

function Deposit({ session, source, onStartOver }: { session: Session; source: PublicSource; onStartOver: () => void }) {
  const asset = ASSETS[session.payAsset];
  const countdown = useCountdown(session.payBy);
  // From the server, so a reload or another device can't offer a second send.
  const [sentHere, setSent] = useState(false);
  // From this browser too, because the server only hears after the wallet answers.
  const guard = sendGuard(session.id);
  const [record, setRecord] = useState<SendRecord>(() => guard.read());
  const sent = sentHere || session.depositSubmitted || record.state === "sent";
  const maybeSent = !sent && record.state === "pending";
  const unreported = !session.depositSubmitted && record.state === "sent" ? record.txHash : null;
  useEffect(() => {
    if (unreported) void api(`/api/checkout/sessions/${session.id}/deposit`, { body: { txHash: unreported } }).catch(() => undefined);
  }, [unreported, session.id]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRestart, setConfirmRestart] = useState(false);
  const overdue = countdown !== null && countdown.left === 0;

  const payFromWallet = async () => {
    if (!session.depositAddress || !session.payBase) return;
    setSending(true);
    setError(null);
    try {
      const from = await connectWallet();
      guard.begin();
      const txHash = await sendDeposit({ asset, to: session.depositAddress, amountBase: session.payBase, from }).catch((failure: unknown) => {
        guard.clear();
        throw failure;
      });
      guard.done(txHash);
      // One send per address: the button stays off from here, so a second tap can't pay twice.
      setSent(true);
      await api(`/api/checkout/sessions/${session.id}/deposit`, { body: { txHash } }).catch(() => undefined);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSending(false);
    }
  };

  const simulate = async (scenario: string) => {
    setSent(true);
    await api(`/api/checkout/sessions/${session.id}/sim`, { body: { scenario } }).catch((failure: unknown) => setError(errorMessage(failure)));
  };

  if (overdue && !sent) {
    return (
      <div className="flex flex-col gap-3" role="alert">
        <p className="flex items-start gap-2 text-body-regular"><RiAlertLine className="mt-0.5 size-5 shrink-0 text-status-orange-text" aria-hidden />This price has run out. Don&apos;t send funds to the old address.</p>
        <p className="text-body-regular text-text-secondary">If you already sent them, don&apos;t pay again. They&apos;re still being tracked and this page updates when they arrive.</p>
        {confirmRestart ? (
          <Button className="h-11 w-full rounded-xl" onClick={onStartOver}>I didn&apos;t send anything, start again</Button>
        ) : (
          <Button variant="secondary" className="h-11 w-full rounded-xl" onClick={() => setConfirmRestart(true)}>Get a new price</Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-body-regular text-text-secondary">Send exactly</p>
        {countdown && <p className="text-body-medium tabular-nums" role="timer" aria-label="Time left to pay">{countdown.label}</p>}
      </div>
      <div className="flex items-center gap-2.5">
        <TokenMark symbol={session.payAsset} />
        <p className="min-w-0 flex-1 text-title-3-semibold tabular-nums [overflow-wrap:anywhere]">{session.payAmount} {session.payAsset}</p>
        {session.payAmount && <Copy text={session.payAmount} label="amount" />}
      </div>
      <p className="text-caption-1-regular text-text-secondary">On <strong>{session.payChain}</strong> only. Any other network may lose your funds.</p>
      <div className="flex flex-col items-center gap-2 rounded-2xl bg-background-secondary-default p-3">
        {/* White, whatever the theme: phones read dark-on-light far more reliably. */}
        <div className="rounded-xl bg-[#fff] p-2"><QRCodeSVG value={session.depositAddress ?? ""} size={148} marginSize={0} /></div>
        <p dir="ltr" className="w-full text-center text-caption-1-medium [overflow-wrap:anywhere]">{session.depositAddress}</p>
        {session.depositAddress && <Copy text={session.depositAddress} label="address" />}
      </div>
      {session.depositMemo && (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-xl bg-status-orange-background p-3 text-status-orange-text">
          <span className="min-w-0 text-body-medium [overflow-wrap:anywhere]">Memo, required: <span dir="ltr">{session.depositMemo}</span></span>
          <Copy text={session.depositMemo} label="memo" />
        </div>
      )}
      {error && <p role="alert" className="text-body-regular text-text-error-primary">{error}</p>}
      {sent ? (
        <p role="status" className="flex items-center gap-2 text-body-medium"><Spinner size="sm" className="text-text-accent" />Waiting to see your payment</p>
      ) : maybeSent ? (
        <div className="flex flex-col gap-2" role="alert">
          <p className="text-body-regular">You may have already sent this from this browser. Check your wallet&apos;s activity before sending again. If you did send it, this page updates by itself.</p>
          <Button variant="secondary" className="h-11 w-full rounded-xl" onClick={() => { guard.clear(); setRecord({ state: "none" }); }}>I checked, nothing was sent</Button>
        </div>
      ) : (
        <>
          {asset.evm && hasWallet() && <Button className="h-11 w-full rounded-xl" disabled={sending} onClick={() => void payFromWallet()}>{sending ? "Check your wallet" : `Pay from wallet on ${asset.chain}`}</Button>}
          <p className="text-caption-1-regular text-text-secondary">Send once. This page updates by itself when your payment is seen.</p>
        </>
      )}
      {source.mode !== "live" && !sent && (
        <div className="flex flex-col gap-2 rounded-xl border border-dashed border-border-button-hover p-2.5">
          <p className="text-caption-1-medium text-text-secondary">Test mode: no real funds</p>
          <div className="flex flex-wrap gap-1.5">
            <Button size="small" onClick={() => void simulate("pay")}>Simulate payment</Button>
            <Button size="small" variant="secondary" onClick={() => void simulate("underpay")}>Underpay</Button>
            <Button size="small" variant="secondary" onClick={() => void simulate("fail")}>Fail</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function Progress({ session }: { session: Session }) {
  const steps = [
    { label: "Payment seen", done: true },
    { label: "Routing through NEAR Intents", done: session.state === "processing", active: session.state !== "processing" },
    { label: `Settling to merchant`, done: false, active: session.state === "processing" },
  ];
  return (
    <div className="flex flex-col gap-3">
      <p className="text-title-3-semibold tabular-nums">{session.payAmount} {session.payAsset}</p>
      {session.state === "incomplete_deposit" ? (
        <p role="alert" className="rounded-xl bg-status-orange-background p-3 text-body-regular text-status-orange-text">
          We saw {session.deposited} {session.payAsset}, which is below the {session.minPayAmount} needed. Send the difference to the same address before the time runs out, or the deposit returns to your wallet automatically, less network fees.
          {session.depositAddress && <span dir="ltr" className="mt-2 block [overflow-wrap:anywhere]">{session.depositAddress}</span>}
        </p>
      ) : (
        <ol className="flex flex-col" aria-live="polite">
          {steps.map((step) => (
            <li key={step.label} className={cx("flex items-center gap-3 py-1 text-body-medium", !step.done && !step.active && "text-text-tertiary")}>
              <span className="flex size-6 shrink-0 items-center justify-center">
                {step.done ? <RiCheckLine className="size-5 text-text-accent" aria-hidden /> : step.active ? <Spinner size="sm" className="text-text-accent" /> : <span className="size-2 rounded-full bg-background-quaternary-default" />}
              </span>
              {step.label}
            </li>
          ))}
        </ol>
      )}
      <p className="text-caption-1-regular text-text-secondary">You can close this page. Your payment keeps going.</p>
    </div>
  );
}

function Receipt({ session, source }: { session: Session; source: PublicSource }) {
  const successUrl = source.success?.mode === "redirect" ? source.success.url : source.successUrl;
  const redirect = successUrl ? returnUrl(successUrl, { paymentId: session.id, sourceId: source.id }) : null;
  const message = source.success?.mode === "message" ? source.success.message : null;
  return (
    <div className="flex flex-col gap-3 motion-safe:animate-[checkout-state_320ms_ease-out_both]" role="status">
      <div className="flex items-center gap-4">
        <span className="relative flex size-14 shrink-0 items-center justify-center text-text-accent motion-safe:animate-[seal-in_700ms_cubic-bezier(0.16,1,0.3,1)_both]">
          <Rosette className="absolute inset-0" rings={4} petals={12} strokeWidth={0.6} />
          <span className="relative flex size-7 items-center justify-center rounded-full bg-accent-500 text-text-on-accent"><RiCheckLine className="size-5" aria-hidden /></span>
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-title-3-semibold">Payment complete</p>
          <p className="text-body-regular text-text-secondary [overflow-wrap:anywhere]">{message || `${source.merchant} received ${session.receiveAmount} ${session.receiveAsset}`}</p>
        </div>
      </div>
      <dl className="flex flex-col gap-1.5">
        <Line label="Paid" value={`${session.deposited ?? session.payAmount} ${session.payAsset}`} />
        <Line label="Amount" value={formatUsd(session.usd)} />
        {session.originTxs[0] && <Line label="Your transaction" value={session.originTxs[0].explorerUrl ? <a href={session.originTxs[0].explorerUrl} target="_blank" rel="noreferrer" dir="ltr" className="text-text-accent underline">{shortAddress(session.originTxs[0].hash)}</a> : <span dir="ltr">{shortAddress(session.originTxs[0].hash)}</span>} />}
        <Line label="Reference" value={<span dir="ltr">{session.id}</span>} />
      </dl>
      {redirect && <ButtonLink href={redirect} variant="secondary" size="small">Return to {source.merchant}</ButtonLink>}
    </div>
  );
}

function Stopped({ session, source, onStartOver }: { session: Session; source: PublicSource; onStartOver: () => void }) {
  const returned = session.state === "provider_refunded";
  // The merchant holds what arrived, so this one isn't a reason to pay again.
  const short = session.state === "underpaid";
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-col gap-3" role="alert">
      <p className="flex items-start gap-2 text-body-medium"><RiErrorWarningLine className="mt-0.5 size-5 shrink-0 text-status-rose-text" aria-hidden />{returned ? "This payment was returned to your wallet" : session.state === "underpaid" ? "This payment arrived short" : "This payment didn't complete"}</p>
      <p className="text-body-regular text-text-secondary [overflow-wrap:anywhere]">
        {returned ? `${session.returned ?? "Your deposit"} ${session.payAsset} went back to ${session.refundAddress}, less network fees. ${source.merchant} wasn't paid.` : session.state === "underpaid" ? `Your payment reached ${source.merchant}, but the route delivered less than it quoted. They've been told. Please don't pay again, and contact ${source.supportEmail || "the merchant"} with the reference below.` : `We're confirming where your funds are. If you sent them, they're being returned to ${session.refundAddress}. Please contact ${source.supportEmail || "the merchant"} with the reference below if they don't arrive.`}
      </p>
      <p dir="ltr" className="text-caption-1-medium text-text-secondary">{session.id}</p>
      {short ? null : returned || confirm ? (
        <>
          {!returned && <p className="text-body-regular">This payment could still complete. If it does, paying again means paying twice.</p>}
          <Button className="h-11 w-full rounded-xl" onClick={onStartOver}>{returned ? "Start a new payment" : "I understand, start a new payment"}</Button>
        </>
      ) : (
        <Button variant="secondary" className="h-11 w-full rounded-xl" onClick={() => setConfirm(true)}>Start a new payment</Button>
      )}
    </div>
  );
}

function Late({ session, onStartOver }: { session: Session; onStartOver: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-col gap-3" role="alert">
      <p className="flex items-start gap-2 text-body-regular"><RiAlertLine className="mt-0.5 size-5 shrink-0 text-status-orange-text" aria-hidden />We haven&apos;t seen a payment for this price, and its time has run out. Don&apos;t send funds to the old address.</p>
      <p className="text-body-regular text-text-secondary">If you already sent them, don&apos;t pay again. They&apos;re still being tracked, and this page updates when they arrive.</p>
      <p dir="ltr" className="text-caption-1-medium text-text-secondary">{session.id}</p>
      {confirm ? <Button className="h-11 w-full rounded-xl" onClick={onStartOver}>I didn&apos;t send anything, start again</Button> : <Button variant="secondary" className="h-11 w-full rounded-xl" onClick={() => setConfirm(true)}>Get a new price</Button>}
    </div>
  );
}

/** The customer's whole payment. A reload resumes it, so nobody is shown a second address by accident. */
export function LiveCheckout({ sourceId }: { sourceId: string }) {
  const [source, setSource] = useState<PublicSource | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [resumed, setResumed] = useState(false);
  const told = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<PublicSource>(`/api/checkout/${sourceId}/source`).then(setSource).catch((failure: unknown) => setLoadError(errorMessage(failure)));
    const saved = recall(sourceId);
    (saved
      ? api<Session>(`/api/checkout/sessions/${saved}`)
          .then(setSession)
          .catch((failure: unknown) => {
            // Only a real "no such payment" forgets it. An outage must not make money on its way look unpaid.
            if (failure instanceof ApiError && failure.status === 404) remember(sourceId, null);
            else setLoadError("We couldn't check on your payment just now. Please reload this page. Don't pay again.");
          })
      : Promise.resolve()
    ).finally(() => setResumed(true));
  }, [sourceId]);

  useEffect(() => {
    if (!session || ["settled", "underpaid", "refunded", "provider_refunded", "refund_pending"].includes(session.state)) return;
    const timer = window.setInterval(() => {
      api<Session>(`/api/checkout/sessions/${session.id}`).then(setSession).catch(() => undefined);
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [session]);

  useEffect(() => {
    if (!session || told.current === session.state) return;
    told.current = session.state;
    tellParent("payment.state", { paymentId: session.id, state: session.state, status: session.status });
    if (session.state === "settled") tellParent("payment.settled", { paymentId: session.id, state: session.state, status: session.status });
  }, [session]);

  useEffect(() => {
    const node = root.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => tellParent("resize", { height: Math.ceil(node.getBoundingClientRect().height) }));
    observer.observe(node);
    return () => observer.disconnect();
  }, [source]);

  const startSession = useCallback((next: Session) => {
    remember(sourceId, next.id);
    setSession(next);
  }, [sourceId]);

  const startOver = useCallback(() => {
    remember(sourceId, null);
    told.current = null;
    setSession(null);
  }, [sourceId]);

  if (loadError) {
    return <div className="stage-card flex max-w-[360px] flex-col items-center gap-2 rounded-3xl p-8 text-center"><h1 className="text-headline-semibold">This page isn&apos;t available</h1><p className="text-body-regular text-text-secondary">{loadError}</p></div>;
  }
  if (!source || !resumed) return <div ref={root} className="flex min-h-40 items-center justify-center"><Spinner /></div>;

  let body: ReactNode;
  if (session) {
    if (session.state === "settled" || session.state === "refund_pending" || session.state === "refunded") body = <Receipt session={session} source={source} />;
    else if (session.state === "provider_refunded" || session.state === "failed" || session.state === "underpaid") body = <Stopped session={session} source={source} onStartOver={startOver} />;
    else if (session.state === "expired") body = <Late session={session} onStartOver={startOver} />;
    else if (SEEN.has(session.state)) body = <Progress session={session} />;
    else body = <Deposit session={session} source={source} onStartOver={startOver} />;
  } else if (source.closedReason) {
    body = <p role="alert" className="text-body-regular text-text-secondary">{source.closedReason}</p>;
  } else {
    body = <Choose source={source} onSession={startSession} />;
  }

  return <div ref={root} className="contents"><Shell source={source}>{body}</Shell></div>;
}
