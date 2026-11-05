"use client";

import { useState, type CSSProperties } from "react";
import { QRCodeSVG } from "qrcode.react";
import { RiCheckLine, RiFileCopyLine, RiLinksLine, RiLayoutMasonryLine, RiLockLine, RiMailLine } from "@remixicon/react";
import { Radio as AriaRadio, RadioGroup as AriaRadioGroup, Tab as AriaTab, TabList as AriaTabList, TabPanel as AriaTabPanel, Tabs as AriaTabs } from "react-aria-components";
import { toast } from "@/components/base/toast/toast";
import { LogoMark } from "@/components/brand/logo";
import { Rosette } from "@/components/brand/rosette";
import { TokenMark } from "@/components/brand/token-mark";
import { CheckoutWidget } from "@/components/checkout/checkout-widget";
import { NavButton } from "@/components/nav-button";
import { SITE } from "@/lib/site";
import { useOrigin } from "@/lib/use-origin";
import type { AssetSymbol, WidgetRadius } from "@/lib/types";
import { cx } from "@/utils/cx";

const DEMO_LINK = "/pay/lnk_8fk2m1";
// What the mock shows and the QR encodes. `.example` is reserved, so it can never resolve to someone.
const DISPLAY_LINK = "pay.gateway.example/lnk_8fk2m1";
const PAYERS: AssetSymbol[] = ["BTC", "ETH", "SOL", "USDT"];
// Mid-tones only: each has to read on both the paper and the ink ground.
const ACCENTS = [
  { value: "#00EC97", name: "Green" },
  { value: "#2563eb", name: "Blue" },
  { value: "#7c3aed", name: "Violet" },
  { value: "#db2777", name: "Pink" },
  { value: "#ea580c", name: "Orange" },
];
const RADII: { value: WidgetRadius; name: string }[] = [
  { value: "rounded", name: "Round" },
  { value: "soft", name: "Soft" },
  { value: "sharp", name: "Sharp" },
];

const PRODUCTS = [
  {
    id: "links",
    name: "Payment Links",
    icon: RiLinksLine,
    body: "For billing someone directly. Set an amount, share a link or QR code, and it opens a hosted checkout.",
    note: "Opens a hosted checkout",
    cta: "Create a link",
    href: "/dashboard/links/new",
  },
  {
    id: "widgets",
    name: "Payment Widgets",
    icon: RiLayoutMasonryLine,
    body: "For your own pages. Match the checkout to your brand, then copy the embed code. Try the colours here.",
    note: "Live preview, simulated payments",
    cta: "Build a widget",
    href: "/dashboard/widgets/new",
  },
];

export function Products() {
  return (
    <section id="products" aria-labelledby="products-title" className="products">
      <AriaTabs orientation="vertical" className="products-frame products-layout">
        <div className="products-side">
          <h2 id="products-title" className="section-display text-text-primary">Two ways to get paid</h2>
          <AriaTabList aria-label="Products" className="products-tabs">
            {PRODUCTS.map(({ id, name, icon: Icon, body }) => (
              <AriaTab key={id} id={id} className={({ isFocusVisible }) => cx("products-tab", isFocusVisible && "is-focus")}>
                <Icon className="products-tab-icon" aria-hidden />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-body-semibold text-text-primary">{name}</span>
                  <span className="products-tab-body text-body-regular text-text-secondary">{body}</span>
                </span>
              </AriaTab>
            ))}
          </AriaTabList>
          <p className="text-caption-1-regular text-text-secondary">Gateway is a working demo. Payments here are simulated and no funds move.</p>
        </div>

        <AriaTabPanel id="links" className="products-stage stage-plate outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring">
          <LinkVisual />
        </AriaTabPanel>
        <AriaTabPanel id="widgets" className="products-stage stage-plate outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring">
          <WidgetVisual />
        </AriaTabPanel>
      </AriaTabs>
    </section>
  );
}

function StageFoot({ product }: { product: (typeof PRODUCTS)[number] }) {
  return (
    <div className="products-foot">
      <span className="text-body-regular text-text-secondary">{product.note}</span>
      <NavButton href={product.href} className="products-cta">{product.cta}</NavButton>
    </div>
  );
}

function LinkVisual() {
  const origin = useOrigin();
  const url = `${origin}${DEMO_LINK}`;
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy", { description: "Your browser blocked clipboard access. Open the link and copy it from the address bar." });
    }
  };

  return (
    <div className="products-view">
      <div className="link-view">
        <div className="link-invoice">
          <p className="text-body-regular text-text-secondary">{SITE.merchant}</p>
          <p className="text-body-semibold text-text-primary">Brand sprint deposit</p>
          <p className="link-amount tabular-nums text-text-primary">$2,400<span className="text-text-secondary">.00</span></p>
          <span aria-hidden className="stage-rule" />
          <div className="flex items-center gap-3">
            <span className="flex">
              {PAYERS.map((symbol) => <TokenMark key={symbol} symbol={symbol} size="xs" className="-me-1 rounded-full ring-2 ring-[var(--stage-surface)]" />)}
            </span>
            <span className="text-body-regular text-text-secondary">Any supported asset</span>
          </div>
        </div>

        <div className="link-share">
          <div className="link-qr">
            <QRCodeSVG value={`https://${DISPLAY_LINK}`} size={104} bgColor="transparent" fgColor="currentColor" title="QR code for the demo payment link" />
          </div>
          <div className="flex w-full min-w-0 flex-col gap-2">
            <a dir="ltr" href={DEMO_LINK} className="link-url">{DISPLAY_LINK}</a>
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" onClick={copy} className="link-action is-primary">
                {copied ? <RiCheckLine className="size-4" aria-hidden /> : <RiFileCopyLine className="size-4" aria-hidden />}
                {copied ? "Copied" : "Copy link"}
              </button>
              <a href={`mailto:?subject=${encodeURIComponent("Payment link")}&body=${encodeURIComponent(url)}`} className="link-action">
                <RiMailLine className="size-4" aria-hidden />Email
              </a>
            </div>
          </div>
        </div>
      </div>
      <StageFoot product={PRODUCTS[0]} />
    </div>
  );
}

function WidgetVisual() {
  const [accent, setAccent] = useState(ACCENTS[0].value);
  const [radius, setRadius] = useState<WidgetRadius>("rounded");

  return (
    <div className="products-view">
      <div className="browser">
        <div className="browser-bar">
          <span className="browser-lock"><RiLockLine className="size-3" aria-hidden />lumen.studio/print</span>
        </div>
        <div className="browser-page">
          <div className="browser-product">
            <span aria-hidden className="browser-print" style={{ "--print": accent } as CSSProperties}><Rosette petals={28} rings={9} strokeWidth={0.22} inner={14} outer={47} /></span>
            <div className="flex min-w-0 flex-col">
              <p className="truncate text-body-semibold text-text-primary">Rosette print, A2</p>
              <p className="truncate text-caption-1-regular text-text-secondary">Edition of 200</p>
            </div>
            <div className="widget-controls">
              <AriaRadioGroup aria-label="Widget colour" value={accent} onChange={setAccent} orientation="horizontal" className="flex items-center gap-0.5">
                {ACCENTS.map((item) => (
                  <AriaRadio key={item.value} value={item.value} aria-label={item.name} className={({ isSelected, isFocusVisible }) => cx("widget-swatch", isSelected && "is-selected", isFocusVisible && "is-focus")}>
                    <span style={{ background: item.value }} />
                  </AriaRadio>
                ))}
              </AriaRadioGroup>
              <AriaRadioGroup aria-label="Widget corners" value={radius} onChange={(value) => setRadius(value as WidgetRadius)} orientation="horizontal" className="flex items-center gap-0.5">
                {RADII.map((item) => (
                  <AriaRadio key={item.value} value={item.value} className={({ isSelected, isFocusVisible }) => cx("widget-radius", isSelected && "is-selected", isFocusVisible && "is-focus")}>
                    {item.name}
                  </AriaRadio>
                ))}
              </AriaRadioGroup>
            </div>
          </div>
          <CheckoutWidget
            merchant={SITE.merchant}
            title="Rosette print, A2"
            amount={79}
            receiveAsset="USDC"
            payAsset="ETH"
            showAssetPicker={false}
            showBranding={false}
            accent={accent}
            radius={radius}
            buttonLabel="Buy print"
            className="browser-widget"
          />
        </div>
      </div>
      <StageFoot product={PRODUCTS[1]} />
    </div>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-foot">
      <div className="products-frame site-foot-row">
        <span className="inline-flex items-center gap-2 text-body-semibold text-text-primary"><span className="flex size-6 items-center justify-center rounded-md bg-accent-500 text-text-on-accent"><LogoMark className="size-4" /></span>{SITE.name}</span>
        <span className="text-body-regular text-text-secondary">Powered by NEAR Intents</span>
      </div>
    </footer>
  );
}
