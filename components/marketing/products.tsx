"use client";

import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { QRCodeSVG } from "qrcode.react";
import { RiArrowRightLine, RiLockLine } from "@remixicon/react";
import { Radio as AriaRadio, RadioGroup as AriaRadioGroup } from "react-aria-components";
import { TokenMark } from "@/components/brand/token-mark";
import { CheckoutWidget } from "@/components/checkout/checkout-widget";
import { NavButton } from "@/components/nav-button";
import { ASSETS, RECEIVE_ASSETS } from "@/lib/assets";
import { embedSnippet } from "@/lib/embed";
import { formatToken } from "@/lib/format";
import { SITE } from "@/lib/site";
import type { AssetSymbol, WidgetRadius } from "@/lib/types";
import { cx } from "@/utils/cx";
import { Bus } from "./bus";

const SERIAL = "lnk_8fk2m1";
// What the mock shows and the QR encodes. `.example` is reserved, so it can never resolve to someone.
const DISPLAY_LINK = `pay.gateway.example/${SERIAL}`;
const DISPLAY_ORIGIN = "https://gateway.example";
const NOTE_AMOUNT = 2400;
const NOTE_RECEIVE: AssetSymbol = "USDC";
const PAYERS: AssetSymbol[] = ["BTC", "ETH", "SOL", "USDT", "NEAR"];
const MICROPRINT = `PAYMENT LINK ${SERIAL.toUpperCase()}  ANY ASSET IN ONE ASSET OUT  `.repeat(12);
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

export function Products() {
  return (
    <div id="products" className="scenes">
      <Bus span={2400} delay={-2.4} className="bus-spine" />
      <span aria-hidden className="scenes-seam"><span className="scenes-port"><span className="stage-socket is-main" /></span></span>

      <Scene
        id="links"
        title="Send a link."
        body="Set an amount and share a URL or QR code. It opens a hosted checkout your customer can pay from any chain."
        cta="Create a link"
        href="/dashboard/links/new"
      >
        <LinkPlate />
      </Scene>

      <Scene
        id="widgets"
        title="Or embed the checkout."
        body="Match it to your brand, copy the embed code, and it sits on your own page. The one below is live: change it."
        cta="Build a widget"
        href="/dashboard/widgets/new"
        flip
      >
        <WidgetPlate />
      </Scene>
    </div>
  );
}

/** Heading and body sit either side of the axis and swap between scenes, the way the hero's headline does. */
function Scene({ id, title, body, cta, href, flip = false, children }: { id: string; title: string; body: string; cta: string; href: string; flip?: boolean; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cx("scene", flip && "is-flipped")}>
      <div className="scene-head">
        <h2 id={`${id}-title`} className="scene-title">{title}</h2>
        <div className="scene-side">
          <p className="scene-body">{body}</p>
          <NavButton href={href} trailingIcon={RiArrowRightLine} className="scene-cta">{cta}</NavButton>
        </div>
      </div>
      {children}
      <Bus span={96} delay={-1.6} className="bus-stub" />
    </section>
  );
}

function PlatePorts() {
  return (
    <>
      <span aria-hidden className="plate-port is-top"><span className="stage-socket is-main" /></span>
      <span aria-hidden className="plate-port is-bottom"><span className="stage-socket is-main" /></span>
    </>
  );
}

function LinkPlate() {
  return (
    <div className="stage-plate scene-plate reveal">
      <PlatePorts />
      <div className="note-mount"><PaymentNote /></div>
      <div className="tray">
        <span dir="ltr" className="tray-url">{DISPLAY_LINK}</span>
        <NavButton href="/login?new=1" variant="secondary" trailingIcon={RiArrowRightLine} className="tray-action">Make your own</NavButton>
      </div>
    </div>
  );
}

/**
 * A payment link drawn as what it is: a modern cheque. It stays on ink in both themes, so `dark`
 * scopes its tokens. The rosettes turn with scroll and the foil and tilt follow the pointer; the
 * pointer values are written straight to CSS variables so moving over it never renders React.
 */
function PaymentNote() {
  const note = useRef<HTMLDivElement>(null);
  const frame = useRef(0);

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    const { clientX, clientY } = event;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const element = note.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      element.style.setProperty("--mx", ((clientX - rect.left) / rect.width).toFixed(3));
      element.style.setProperty("--my", ((clientY - rect.top) / rect.height).toFixed(3));
    });
  };
  const onLeave = () => {
    cancelAnimationFrame(frame.current);
    note.current?.style.setProperty("--mx", "0.5");
    note.current?.style.setProperty("--my", "0.5");
  };

  return (
    <div ref={note} onPointerMove={onMove} onPointerLeave={onLeave} className="note dark">
      <div aria-hidden className="note-art"><i /><i /></div>
      <span aria-hidden className="note-band is-top" />
      <span aria-hidden className="note-band is-bottom" />
      <span aria-hidden className="note-frame" />
      <span aria-hidden className="note-glare" />

      <div className="note-body">
        <div className="note-who">
          <p className="note-merchant">{SITE.merchant}</p>
          <p className="note-title">Brand sprint deposit</p>
        </div>
        <p className="note-amount"><span>$2,400</span><span className="note-cents">.00</span></p>
        <div className="note-terms">
          <p className="note-pay">
            <span className="note-tokens">
              {PAYERS.map((symbol) => <TokenMark key={symbol} symbol={symbol} size="xs" className="note-token" />)}
            </span>
            Payable in any supported asset
          </p>
          <p className="note-settle">Settles as {formatToken(NOTE_AMOUNT, NOTE_RECEIVE)} on {ASSETS[NOTE_RECEIVE].chain}</p>
        </div>
      </div>

      <span aria-hidden className="note-foil" />

      <div className="note-seal">
        <span aria-hidden className="note-seal-ring" />
        <div className="note-qr">
          <QRCodeSVG value={`https://${DISPLAY_LINK}`} size={148} bgColor="transparent" fgColor="currentColor" title="QR code for the demo payment link" />
        </div>
        <p dir="ltr" className="note-serial">No. {SERIAL}</p>
      </div>

      <span className="note-stamp">Specimen</span>
      <p aria-hidden className="note-micro">{MICROPRINT}</p>
    </div>
  );
}

function WidgetPlate() {
  const [accent, setAccent] = useState(ACCENTS[0].value);
  const [radius, setRadius] = useState<WidgetRadius>("rounded");
  const [receive, setReceive] = useState<AssetSymbol>("USDC");

  return (
    <div className="stage-plate scene-plate console reveal" style={{ "--brand": accent } as CSSProperties}>
      <PlatePorts />
      <div className="console-controls">
        <Control label="Accent">
          <AriaRadioGroup aria-label="Widget colour" value={accent} onChange={setAccent} orientation="horizontal" className="swatches">
            {ACCENTS.map((item) => (
              <AriaRadio key={item.value} value={item.value} aria-label={item.name} className={({ isSelected, isFocusVisible }) => cx("swatch", isSelected && "is-selected", isFocusVisible && "is-focus")}>
                <span style={{ background: item.value }} />
              </AriaRadio>
            ))}
          </AriaRadioGroup>
        </Control>
        <Control label="Corners">
          <AriaRadioGroup aria-label="Widget corners" value={radius} onChange={(value) => setRadius(value as WidgetRadius)} orientation="horizontal" className="segments">
            {RADII.map((item) => (
              <AriaRadio key={item.value} value={item.value} className={({ isSelected, isFocusVisible }) => cx("segment", isSelected && "is-selected", isFocusVisible && "is-focus")}>
                {item.name}
              </AriaRadio>
            ))}
          </AriaRadioGroup>
        </Control>
        <Control label="Get paid in">
          <AriaRadioGroup aria-label="Asset you get paid in" value={receive} onChange={(value) => setReceive(value as AssetSymbol)} orientation="horizontal" className="segments">
            {RECEIVE_ASSETS.map((asset) => (
              <AriaRadio key={asset.symbol} value={asset.symbol} className={({ isSelected, isFocusVisible }) => cx("segment segment-asset", isSelected && "is-selected", isFocusVisible && "is-focus")}>
                <TokenMark symbol={asset.symbol} size="xs" />{asset.symbol}
              </AriaRadio>
            ))}
          </AriaRadioGroup>
        </Control>
        <span aria-hidden className="stage-rule console-rule" />
        <div className="console-embed">
          <p className="stage-caption">Embed</p>
          <pre dir="ltr" className="console-code"><code>{embedSnippet(DISPLAY_ORIGIN, "wgt_lumen", "html", { accent, radius, receiveAsset: receive, buttonLabel: "Buy print" })}</code></pre>
          <p className="text-caption-1-regular text-text-secondary">Live preview with illustrative prices. No funds move here.</p>
        </div>
      </div>

      <div className="shop">
        <div className="shop-bar">
          <span aria-hidden className="shop-lights"><i /><i /><i /></span>
          <span className="shop-url"><RiLockLine className="size-3" aria-hidden />lumen.studio/print</span>
        </div>
        <div className="shop-page">
          <div className="shop-product">
            <div className="shop-wall">
              <span aria-hidden className="shop-print"><i /></span>
            </div>
            <div className="shop-caption">
              <p className="truncate text-body-semibold text-text-primary">Rosette print, A2</p>
              <p className="truncate text-caption-1-regular text-text-secondary">Edition of 200</p>
            </div>
          </div>
          <CheckoutWidget
            merchant={SITE.merchant}
            title="Rosette print, A2"
            amount={79}
            receiveAsset={receive}
            payAsset="ETH"
            showAssetPicker={false}
            showBranding={false}
            accent={accent}
            radius={radius}
            buttonLabel="Buy print"
            className="shop-widget"
          />
        </div>
      </div>
    </div>
  );
}

function Control({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="console-control">
      <p className="stage-caption">{label}</p>
      {children}
    </div>
  );
}
