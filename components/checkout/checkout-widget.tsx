"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { RiCheckLine, RiLock2Line } from "@remixicon/react";
import { Radio as AriaRadio, RadioGroup as AriaRadioGroup } from "react-aria-components";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { NumberField } from "@/components/base/number-field/number-field";
import { Spinner } from "@/components/base/spinner/spinner";
import { Rosette } from "@/components/brand/rosette";
import { TokenMark } from "@/components/brand/token-mark";
import { PAY_ASSETS, quote } from "@/lib/assets";
import { formatToken, formatUsd } from "@/lib/format";
import type { AssetSymbol, WidgetRadius, WidgetSuccess, WidgetTheme } from "@/lib/types";
import { cx } from "@/utils/cx";

export const CHECKOUT_STEPS = [
  { label: "Confirm in wallet", ms: 900 },
  { label: "Routing through NEAR Intents", ms: 1300 },
  { label: "Settling to merchant", ms: 1000 },
];

const RADIUS: Record<WidgetRadius, string> = { rounded: "rounded-3xl", soft: "rounded-2xl", sharp: "rounded-lg" };

/** WCAG relative luminance of a #rgb or #rrggbb colour, or null for any other format. */
function luminance(color: string) {
  const hex = color.trim().replace(/^#/, "");
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  const [r, g, b] = [0, 2, 4].map((at) => {
    const channel = Number.parseInt(full.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Tokens derived from the accent resolve at :root, so a local accent must restate them too.
 * Merchants can pick any colour, so text on it flips by contrast.
 */
function accentStyle(accent: string): CSSProperties {
  const shade = (mix: string, percent: number) => `color-mix(in srgb, ${accent} ${percent}%, ${mix})`;
  const [c300, c400, c600, c700] = [shade("white", 72), shade("white", 86), shade("black", 88), shade("black", 76)];
  const light = luminance(accent);
  // 0.179 is where white and near-black give equal contrast on a background.
  const isLight = light === null ? false : light > 0.179;
  return {
    "--color-accent-400": c400,
    "--color-accent-500": accent,
    "--color-accent-600": c600,
    "--color-accent-700": c700,
    "--color-border-focus-ring": accent,
    "--color-text-on-accent": isLight ? "#04130d" : "#ffffff",
    // Mixed with text-primary, which flips with the theme, so it reads in light, dark and auto.
    "--color-text-accent": `color-mix(in srgb, ${accent} 62%, var(--color-text-primary))`,
    "--color-button-secondary-border": accent,
    "--color-button-secondary-hover": `color-mix(in srgb, ${accent} 12%, transparent)`,
    "--color-button-secondary-active": `color-mix(in srgb, ${accent} 22%, transparent)`,
    "--gradient-button-primary-default": `linear-gradient(180deg, ${c400} 0%, ${accent} 42%, ${c600} 100%)`,
    "--gradient-button-primary-hover": `linear-gradient(180deg, ${c300} 0%, ${c400} 42%, ${accent} 100%)`,
    "--gradient-button-primary-active": `linear-gradient(180deg, ${c700} 0%, ${c600} 55%, ${accent} 100%)`,
  } as CSSProperties;
}

export interface CheckoutResult {
  payAsset: AssetSymbol;
  payAmount: number;
  receiveAmount: number;
  usd: number;
}

export interface CheckoutWidgetProps {
  merchant: string;
  title: string;
  description?: string;
  /** USD. Null shows an amount field to the customer. */
  amount: number | null;
  receiveAsset: AssetSymbol;
  payAsset?: AssetSymbol;
  onPayAssetChange?: (asset: AssetSymbol) => void;
  onRunningChange?: (running: boolean) => void;
  /** Null while choosing, the running step's index, or CHECKOUT_STEPS.length once settled. */
  onStepChange?: (step: number | null) => void;
  onSettled?: (result: CheckoutResult) => void;
  /** Rendered in the receipt in place of the default reset action. */
  receiptAction?: ReactNode;
  theme?: WidgetTheme;
  accent?: string;
  radius?: WidgetRadius;
  buttonLabel?: string;
  showBranding?: boolean;
  /** False when the host renders its own asset picker and controls `payAsset`. */
  showAssetPicker?: boolean;
  /** Limits the picker. Undefined accepts every asset. */
  acceptedAssets?: AssetSymbol[];
  /** Quick-pick amounts, shown when the customer sets the amount. */
  presets?: number[];
  /** Data URL shown in place of the merchant's initials. */
  logo?: string;
  collectEmail?: boolean;
  /** What the customer sees once paid. Defaults to the receipt. */
  success?: WidgetSuccess;
  isDisabled?: boolean;
  disabledMessage?: string;
  className?: string;
}

export function CheckoutWidget({
  merchant,
  title,
  description,
  amount,
  receiveAsset,
  payAsset: controlledAsset,
  onPayAssetChange,
  onRunningChange,
  onStepChange,
  onSettled,
  receiptAction,
  theme = "auto",
  accent,
  radius = "rounded",
  buttonLabel,
  showBranding = true,
  showAssetPicker = true,
  acceptedAssets,
  presets = [],
  logo,
  collectEmail = false,
  success,
  isDisabled = false,
  disabledMessage,
  className,
}: CheckoutWidgetProps) {
  const [innerAsset, setInnerAsset] = useState<AssetSymbol>("ETH");
  const [customAmount, setCustomAmount] = useState(50);
  // Null while the customer is choosing; otherwise the index of the running step.
  const [step, setStepState] = useState<number | null>(null);
  const [email, setEmail] = useState("");
  const pickable = acceptedAssets ? PAY_ASSETS.filter((asset) => acceptedAssets.includes(asset.symbol)) : PAY_ASSETS;
  const payAsset = controlledAsset ?? (pickable.some((asset) => asset.symbol === innerAsset) ? innerAsset : (pickable[0]?.symbol ?? innerAsset));
  const usd = amount ?? customAmount;
  const valid = Number.isFinite(usd) && usd > 0;
  const { payAmount, receiveAmount, feeUsd } = quote(valid ? usd : 0, payAsset, receiveAsset);
  const done = step === CHECKOUT_STEPS.length;
  const setStep = (next: number | null) => {
    setStepState(next);
    onStepChange?.(next);
  };

  useEffect(() => {
    if (step === null || step >= CHECKOUT_STEPS.length) return;
    const timer = window.setTimeout(() => {
      const next = step + 1;
      setStep(next);
      if (next === CHECKOUT_STEPS.length) {
        onRunningChange?.(false);
        onSettled?.({ payAsset, payAmount, receiveAmount, usd });
      }
    }, CHECKOUT_STEPS[step].ms);
    return () => window.clearTimeout(timer);
    // The quote is locked for the duration of a run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const start = () => {
    onRunningChange?.(true);
    setStep(0);
  };

  return (
    <section
      aria-label={`Checkout for ${merchant}`}
      style={accent ? accentStyle(accent) : undefined}
      className={cx(
        theme === "light" && "theme-scope-light",
        // The dark inner surface is translucent, so a dark widget on a light page needs a solid ground.
        theme === "dark" ? "dark bg-background-full" : "bg-background-inner-default",
        "flex w-full max-w-[400px] flex-col gap-5 border border-border-button-default p-5 text-text-primary shadow-lg",
        RADIUS[radius],
        className,
      )}
    >
      <header className="flex items-center gap-3">
        {logo ? (
          // A local data URL from the builder, so there is nothing for next/image to optimise.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="" className="size-9 shrink-0 rounded-full object-cover" />
        ) : (
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-accent-500)_16%,transparent)] text-caption-1-semibold text-text-accent">
            {merchant.slice(0, 2).toUpperCase()}
          </span>
        )}
        <div className="flex min-w-0 flex-col">
          <p className="truncate text-body-regular text-text-secondary">{merchant}</p>
          <h3 className="truncate text-body-semibold">{title}</h3>
        </div>
      </header>
      {description && <p className="-mt-2 text-body-regular text-text-secondary">{description}</p>}

      {/* Every state shares one grid cell, so the card keeps its size and nothing around it moves. */}
      <div className="grid [&>*]:[grid-area:1/1]">
        <div aria-hidden={step !== null} inert={step !== null} className={cx("flex flex-col gap-5", step !== null && "invisible")}>
          {amount === null ? (
            <div className="flex flex-col gap-2">
              <NumberField
                label="Amount"
                value={customAmount}
                onChange={setCustomAmount}
                minValue={1}
                formatOptions={{ style: "currency", currency: "USD" }}
              />
              {presets.length > 0 && (
                <div role="group" aria-label="Suggested amounts" className="flex flex-wrap gap-1.5">
                  {presets.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      aria-pressed={customAmount === preset}
                      onClick={() => setCustomAmount(preset)}
                      className={cx(
                        "cursor-pointer rounded-lg px-2.5 py-1 text-body-medium tabular-nums outline-none transition-[background-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-border-focus-ring",
                        customAmount === preset ? "bg-background-secondary-default shadow-[inset_0_0_0_1.5px_var(--color-accent-500)]" : "shadow-[inset_0_0_0_1px_var(--color-border-button-default)] hover:bg-background-primary-hover",
                      )}
                    >
                      {formatUsd(preset).replace(".00", "")}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <Amount usd={amount} />
          )}

          {showAssetPicker && (
            <AriaRadioGroup
              aria-label="Pay with"
              value={payAsset}
              onChange={(value) => {
                setInnerAsset(value as AssetSymbol);
                onPayAssetChange?.(value as AssetSymbol);
              }}
              className="flex flex-col gap-2"
            >
              <span className="text-body-medium text-text-secondary">Pay with</span>
              <div className="grid grid-cols-4 gap-1.5">
                {pickable.map((asset) => (
                  <AriaRadio
                    key={asset.symbol}
                    value={asset.symbol}
                    aria-label={`${asset.name} on ${asset.chain}`}
                    className={({ isSelected, isFocusVisible }) =>
                      cx(
                        "flex cursor-pointer flex-col items-center gap-1 rounded-xl py-2 outline-none transition-[background-color,box-shadow] duration-150",
                        isSelected ? "bg-background-secondary-default shadow-[inset_0_0_0_1.5px_var(--color-accent-500)]" : "shadow-[inset_0_0_0_1px_var(--color-border-button-default)] hover:bg-background-primary-hover",
                        isFocusVisible && "ring-2 ring-border-focus-ring",
                      )
                    }
                  >
                    <TokenMark symbol={asset.symbol} size="sm" />
                    <span className="text-caption-1-medium">{asset.symbol}</span>
                  </AriaRadio>
                ))}
              </div>
            </AriaRadioGroup>
          )}

          {collectEmail && <Input label="Email for your receipt" type="email" placeholder="you@example.com" inputDir="ltr" value={email} onChange={setEmail} />}

          <Route
            payAsset={payAsset}
            payLabel={formatToken(payAmount, payAsset)}
            feeLabel={payAsset === receiveAsset ? "None" : formatUsd(feeUsd)}
            receiveAsset={receiveAsset}
            receiveLabel={formatToken(receiveAmount, receiveAsset)}
          />

          <div className="flex flex-col gap-2">
            <Button className="h-11 w-full rounded-xl" disabled={!valid || isDisabled} onClick={start}>
              {buttonLabel ?? `Pay ${formatToken(payAmount, payAsset)}`}
            </Button>
            {isDisabled && disabledMessage && <p className="text-center text-body-regular text-text-secondary">{disabledMessage}</p>}
          </div>
        </div>

        {done ? (
          <div className="flex flex-col justify-between gap-3 motion-safe:animate-[checkout-state_320ms_ease-out_both]" role="status">
            <div className="flex items-center gap-4">
              <span className="relative flex size-14 shrink-0 items-center justify-center text-text-accent motion-safe:animate-[seal-in_700ms_cubic-bezier(0.16,1,0.3,1)_both]">
                <Rosette className="absolute inset-0" rings={4} petals={12} strokeWidth={0.6} />
                <span className="relative flex size-7 items-center justify-center rounded-full bg-accent-500 text-text-on-accent">
                  <RiCheckLine className="size-5" aria-hidden />
                </span>
              </span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-title-3-semibold">Payment settled</p>
                <p className="text-body-regular text-text-secondary [overflow-wrap:anywhere]">
                  {success?.mode === "message" && success.message ? success.message : success?.mode === "redirect" && success.url ? `Next, customers go to ${success.url}` : `${formatToken(receiveAmount, receiveAsset)} received`}
                </p>
              </div>
            </div>
            <Route
              payAsset={payAsset}
              payLabel={formatToken(payAmount, payAsset)}
              feeLabel={payAsset === receiveAsset ? "None" : formatUsd(feeUsd)}
              receiveAsset={receiveAsset}
              receiveLabel={formatToken(receiveAmount, receiveAsset)}
              paid
            />
            {receiptAction ?? (
              <Button variant="secondary" className="h-11 w-full rounded-xl" onClick={() => setStep(null)}>
                Make another payment
              </Button>
            )}
          </div>
        ) : step !== null ? (
          <div className="flex flex-col justify-between gap-3 motion-safe:animate-[checkout-state_320ms_ease-out_both]">
            <Amount usd={usd} />
            <ol className="flex flex-col" aria-live="polite">
              {CHECKOUT_STEPS.map((item, index) => (
                <li key={item.label} className={cx("relative flex items-center gap-3 py-1 text-body-medium", index > step && "text-text-tertiary")}>
                  {index < CHECKOUT_STEPS.length - 1 && (
                    <span aria-hidden className={cx("absolute start-3 top-1/2 h-full w-px -translate-x-1/2 transition-colors duration-300 rtl:translate-x-1/2", index < step ? "bg-accent-500" : "bg-separator-border")} />
                  )}
                  <span className="relative flex size-6 shrink-0 items-center justify-center rounded-full bg-background-primary-default">
                    {index < step ? (
                      <RiCheckLine className="size-5 text-text-accent" aria-hidden />
                    ) : index === step ? (
                      <Spinner size="sm" className="text-text-accent" />
                    ) : (
                      <span className="size-2 rounded-full bg-background-quaternary-default" />
                    )}
                  </span>
                  {item.label}
                </li>
              ))}
            </ol>
            <div className="flex h-11 items-center justify-between gap-3 rounded-xl bg-background-secondary-default px-3 text-body-regular">
              <span className="flex min-w-0 items-center gap-2">
                <TokenMark symbol={payAsset} size="xs" />
                <span className="truncate tabular-nums">{formatToken(payAmount, payAsset)}</span>
              </span>
              <span className="flex min-w-0 items-center gap-2">
                <TokenMark symbol={receiveAsset} size="xs" />
                <span className="truncate tabular-nums">{formatToken(receiveAmount, receiveAsset)}</span>
              </span>
            </div>
          </div>
        ) : null}
      </div>

      {showBranding && (
        <footer className="flex items-center justify-center gap-1 text-caption-1-regular text-text-secondary">
          <RiLock2Line className="size-3.5" aria-hidden />
          Non-custodial, powered by NEAR Intents
        </footer>
      )}
    </section>
  );
}

/** Cents step down in weight so the dollars read first. */
function Amount({ usd }: { usd: number }) {
  const [whole, cents] = formatUsd(usd).split(".");
  return (
    <p className="text-[2.75rem] leading-none font-semibold tracking-[-0.035em] tabular-nums">
      {whole}<span className="text-text-secondary">.{cents}</span>
    </p>
  );
}

/** The quote as what it is: a path from what the customer pays to what the merchant gets. */
function Route({ payAsset, payLabel, feeLabel, receiveAsset, receiveLabel, paid = false }: { payAsset: AssetSymbol; payLabel: string; feeLabel: string; receiveAsset: AssetSymbol; receiveLabel: string; paid?: boolean }) {
  return (
    <dl className="relative flex flex-col gap-2 text-start text-body-regular">
      <span aria-hidden className="absolute start-3 top-4 bottom-4 w-px -translate-x-1/2 bg-separator-border rtl:translate-x-1/2" />
      <Row label={paid ? "Paid" : "You pay"} value={payLabel} mark={<TokenMark symbol={payAsset} size="sm" />} />
      <Row label="Route fee" value={feeLabel} muted mark={<span className="size-2 rounded-full bg-background-quaternary-default" />} />
      <Row label={paid ? "Received" : "Merchant receives"} value={receiveLabel} strong mark={<TokenMark symbol={receiveAsset} size="sm" />} />
    </dl>
  );
}

function Row({ label, value, mark, strong = false, muted = false }: { label: string; value: string; mark: ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <div className="relative flex items-center gap-3">
      <span className="flex size-6 shrink-0 items-center justify-center">{mark}</span>
      <dt className="min-w-0 flex-1 truncate text-text-secondary">{label}</dt>
      <dd className={cx("shrink-0 tabular-nums", strong && "text-body-semibold", muted && "text-text-secondary")}>{value}</dd>
    </div>
  );
}
