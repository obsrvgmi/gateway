"use client";

import { useState } from "react";
import { RiArrowRightLine, RiCoinsLine, RiMailLine, RiPaletteLine, RiPriceTag3Line } from "@remixicon/react";
import { Radio as AriaRadio, RadioGroup as AriaRadioGroup, ToggleButton } from "react-aria-components";
import { NavButton } from "@/components/nav-button";
import { embedSnippet } from "@/lib/embed";
import { formatToken } from "@/lib/format";
import type { AssetSymbol, WidgetRadius, WidgetTheme } from "@/lib/types";
import { cx } from "@/utils/cx";
import { CoinFace, coinClass, ReceivePicker, Scene, Segmented, type SceneFeature } from "./scene";
import { ShopWindow, SHOP_ASSETS } from "./shop-window";

const ACCENTS = [
  { value: "#ea580c", name: "Orange" },
  { value: "#7c3aed", name: "Violet" },
  { value: "#2563eb", name: "Blue" },
  { value: "#db2777", name: "Pink" },
  { value: "#00ec97", name: "Green" },
];
const RADII = [
  { value: "rounded", name: "Round" },
  { value: "soft", name: "Soft" },
  { value: "sharp", name: "Sharp" },
];
const THEMES = [
  { value: "light", name: "Light" },
  { value: "dark", name: "Dark" },
];
const FEATURES: SceneFeature[] = [
  { icon: RiPaletteLine, title: "Your brand", body: "Your logo, colours and shape." },
  { icon: RiCoinsLine, title: "Coins you choose", body: "Accept all of them or just a few." },
  { icon: RiPriceTag3Line, title: "Suggested amounts", body: "One tap prices for tips and gifts." },
  { icon: RiMailLine, title: "Email receipts", body: "Ask for an address at checkout." },
];

export function WidgetScene() {
  const [accent, setAccent] = useState(ACCENTS[0].value);
  const [radius, setRadius] = useState<WidgetRadius>("soft");
  const [theme, setTheme] = useState<WidgetTheme>("light");
  const [accepted, setAccepted] = useState<AssetSymbol[]>(SHOP_ASSETS);
  const [receive, setReceive] = useState<AssetSymbol>("USDC");
  const [received, setReceived] = useState<string | null>(null);

  // The real snippet. It only carries an id, because a widget's settings live in the dashboard.
  const code = embedSnippet("https://gateway.example", "wgt_lumen", "html");

  const toggle = (symbol: AssetSymbol, on: boolean) => setAccepted(SHOP_ASSETS.filter((item) => (item === symbol ? on : accepted.includes(item))));

  return (
    <Scene
      id="widgets"
      flip
      title={<>Add checkout<br /> to your site.</>}
      body="Customers pay on your page, in your brand, and never leave your site."
      cta="Build a widget"
      href="/dashboard/widgets/new"
      demo={<ShopWindow accent={accent} radius={radius} theme={theme} accepted={accepted} receive={receive} onStep={(step) => step === null && setReceived(null)} onSettled={({ receiveAmount }) => setReceived(formatToken(receiveAmount, receive))} />}
      features={FEATURES}
      steps={[
        {
          title: "Make it yours",
          body: "Try it. The checkout changes as you do, and nothing is charged.",
          children: (
            <div className="tune">
              <span>Colour</span>
              <AriaRadioGroup aria-label="Colour" value={accent} onChange={setAccent} orientation="horizontal" className="swatches">
                {ACCENTS.map((item) => (
                  <AriaRadio key={item.value} value={item.value} aria-label={item.name} className={({ isSelected, isFocusVisible }) => cx("swatch", isSelected && "is-selected", isFocusVisible && "is-focus")}>
                    <span style={{ background: item.value }} />
                  </AriaRadio>
                ))}
              </AriaRadioGroup>
              <span>Corners</span>
              <Segmented label="Corners" value={radius} options={RADII} onChange={(value) => setRadius(value as WidgetRadius)} />
              <span>Theme</span>
              <Segmented label="Theme" value={theme} options={THEMES} onChange={(value) => setTheme(value as WidgetTheme)} />
              <span>Accepts</span>
              <div role="group" aria-label="Coins you accept" className="coins">
                {SHOP_ASSETS.map((symbol) => (
                  <ToggleButton key={symbol} aria-label={symbol} isSelected={accepted.includes(symbol)} isDisabled={accepted.length === 1 && accepted[0] === symbol} onChange={(on) => toggle(symbol, on)} className={coinClass}>
                    <CoinFace symbol={symbol} />
                  </ToggleButton>
                ))}
              </div>
            </div>
          ),
        },
        {
          title: "Paste one line of code",
          body: "Copy it into your page and the checkout appears.",
          children: (
            <div className="tray">
              <code dir="ltr" className="tray-url">{code.replace(/\s*\n\s*/g, " ")}</code>
              <NavButton href="/login?new=1" variant="secondary" trailingIcon={RiArrowRightLine} className="tray-action">Make your own</NavButton>
            </div>
          ),
        },
        {
          title: "Get paid your way",
          body: received ? `+${received} received. This demo is simulated.` : "Customers pay with any crypto. You receive:",
          children: <ReceivePicker value={receive} onChange={(asset) => { setReceive(asset); setReceived(null); }} />,
        },
      ]}
    />
  );
}
