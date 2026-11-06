"use client";

import { useRef, useState, type PointerEvent } from "react";
import { QRCodeSVG } from "qrcode.react";
import { RiCheckLine, RiExternalLinkLine, RiFileCopyLine, RiMailLine, RiMoneyDollarCircleLine, RiQrCodeLine, RiTimerLine } from "@remixicon/react";
import { Button, ButtonLink } from "@/components/base/buttons/button";
import { TokenMark } from "@/components/brand/token-mark";
import { ASSETS, quote } from "@/lib/assets";
import { formatToken, formatUsd } from "@/lib/format";
import { SITE } from "@/lib/site";
import { useOrigin } from "@/lib/use-origin";
import type { AssetSymbol } from "@/lib/types";
import { Bus } from "./bus";
import { ReceivePicker, Scene, Segmented, useCopy, type SceneFeature } from "./scene";
import { WidgetScene } from "./widget-scene";

const DEMO_LINK = "/pay/lnk_8fk2m1";
const SERIAL = "lnk_8fk2m1";
// What the mock shows and the QR encodes. `.example` is reserved, so it can never resolve to someone.
const DISPLAY_LINK = `pay.gateway.example/${SERIAL}`;
const PAYERS: AssetSymbol[] = ["BTC", "ETH", "SOL", "USDT", "NEAR"];
const MICROPRINT = `PAYMENT LINK ${SERIAL.toUpperCase()}  PAYABLE IN ANY SUPPORTED ASSET  `.repeat(12);

const AMOUNTS = [250, 800, 2400];
const PURPOSES = [
  { value: "deposit", name: "Deposit", title: "Brand sprint deposit" },
  { value: "invoice", name: "Invoice", title: "Invoice 1042" },
  { value: "order", name: "Order", title: "Custom lamp order" },
];
const FEATURES: SceneFeature[] = [
  { icon: RiMoneyDollarCircleLine, title: "Any amount", body: "Set a price or let them choose." },
  { icon: RiQrCodeLine, title: "QR code included", body: "For invoices, screens and in person." },
  { icon: RiTimerLine, title: "Expiry dates", body: "Close a link when an offer ends." },
  { icon: RiExternalLinkLine, title: "Thank you page", body: "Send customers on after they pay." },
];

export function Products() {
  return (
    <div id="products" className="scenes">
      <Bus span={2400} delay={-2.4} className="bus-spine" />
      <span aria-hidden className="scenes-seam"><span className="scenes-port"><span className="stage-socket is-main" /></span></span>
      <LinkScene />
      <WidgetScene />
    </div>
  );
}

function LinkScene() {
  const origin = useOrigin();
  const url = `${origin}${DEMO_LINK}`;
  const [amount, setAmount] = useState(2400);
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [receive, setReceive] = useState<AssetSymbol>("USDC");
  const { copied, copy } = useCopy(url, "Link copied");

  return (
    <Scene
      id="links"
      title={<>Send a link.<br /> Get paid.</>}
      body="No website needed. Create a payment link in seconds and share it with anyone."
      cta="Create a link"
      href="/dashboard/links/new"
      demo={
        <div className="chat">
          <div className="browser-bar"><span className="browser-url">Message to your client</span></div>
          <div className="chat-thread">
            <p className="chat-bubble is-out">Here&apos;s the link for the {purpose.name.toLowerCase()}.</p>
            <div className="note-mount"><PaymentNote amount={amount} title={purpose.title} receive={receive} /></div>
            <p className="chat-bubble">Paid with SOL. Thanks!</p>
          </div>
        </div>
      }
      features={FEATURES}
      steps={[
        {
          title: "Set the amount",
          body: "Try it. The link changes as you do.",
          children: (
            <div className="tune">
              <span>Amount</span>
              <Segmented label="Amount" value={String(amount)} options={AMOUNTS.map((value) => ({ value: String(value), name: formatUsd(value).replace(".00", "") }))} onChange={(value) => setAmount(Number(value))} />
              <span>For</span>
              <Segmented label="What it's for" value={purpose.value} options={PURPOSES} onChange={(value) => setPurpose(PURPOSES.find((item) => item.value === value) ?? PURPOSES[0])} />
            </div>
          ),
        },
        {
          title: "Share it anywhere",
          body: "Send it in a chat or email, or show the QR code.",
          children: (
            <div className="tray">
              <a dir="ltr" href={DEMO_LINK} className="tray-url">{DISPLAY_LINK}</a>
              <Button variant="secondary" leadingIcon={copied ? RiCheckLine : RiFileCopyLine} onClick={copy} className="tray-action">{copied ? "Copied" : "Copy link"}</Button>
              <ButtonLink variant="secondary" leadingIcon={RiMailLine} href={`mailto:?subject=${encodeURIComponent("Payment link")}&body=${encodeURIComponent(url)}`} className="tray-action">Email</ButtonLink>
            </div>
          ),
        },
        {
          title: "Get paid your way",
          body: "Customers pay with any crypto. You receive:",
          children: <ReceivePicker value={receive} onChange={setReceive} />,
        },
      ]}
    />
  );
}

/**
 * A payment link drawn as what it is: a modern cheque. It stays on ink in both themes, so `dark`
 * scopes its tokens. The rosettes turn with scroll and the foil and tilt follow the pointer; the
 * pointer values are written straight to CSS variables so moving over it never renders React.
 */
function PaymentNote({ amount, title, receive }: { amount: number; title: string; receive: AssetSymbol }) {
  const [whole, cents] = formatUsd(amount).split(".");
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
          <p className="note-title">{title}</p>
        </div>
        <p className="note-amount"><span>{whole}</span><span className="note-cents">.{cents}</span></p>
        <div className="note-terms">
          <p className="note-pay">
            <span className="note-tokens">
              {PAYERS.map((symbol) => <TokenMark key={symbol} symbol={symbol} size="xs" className="note-token" />)}
            </span>
            Payable in any supported asset
          </p>
          <p className="note-settle">Settles as {formatToken(quote(amount, receive, receive).receiveAmount, receive)} on {ASSETS[receive].chain}</p>
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
