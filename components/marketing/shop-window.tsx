"use client";

import { RiLockLine } from "@remixicon/react";
import { CheckoutWidget, type CheckoutResult } from "@/components/checkout/checkout-widget";
import { SITE } from "@/lib/site";
import type { AssetSymbol, WidgetRadius, WidgetTheme } from "@/lib/types";

export const SHOP_ASSETS: AssetSymbol[] = ["ETH", "BTC", "SOL", "USDT"];

interface ShopWindowProps {
  accent: string;
  radius: WidgetRadius;
  theme: WidgetTheme;
  accepted: AssetSymbol[];
  receive: AssetSymbol;
  onStep: (step: number | null) => void;
  onSettled: (result: CheckoutResult) => void;
}

/** A merchant's own page with the real checkout on it. Its colours are the shop's, so it reads as someone else's site. */
export function ShopWindow({ accent, radius, theme, accepted, receive, onStep, onSettled }: ShopWindowProps) {
  return (
    <div className="browser">
      <div className="browser-bar">
        <span aria-hidden className="browser-lights"><i /><i /><i /></span>
        <span dir="ltr" className="browser-url"><RiLockLine className="size-3 shrink-0" aria-hidden /><span className="truncate">lumen.example/halo-lamp</span></span>
      </div>
      <div className="msite">
        <div aria-hidden className="msite-nav">
          <span className="msite-logo">{SITE.merchant}</span>
          <span className="msite-links"><span>Lighting</span><span>Journal</span><span>Cart</span></span>
        </div>
        <div className="msite-main">
          <div className="msite-story">
            <HaloLamp />
            <div>
              <p className="msite-title">Halo table lamp</p>
              <p className="msite-copy">Spun brass, dimmable, made to order.</p>
            </div>
          </div>
          <CheckoutWidget
            merchant={SITE.merchant}
            title="Halo table lamp"
            amount={189}
            receiveAsset={receive}
            theme={theme}
            accent={accent}
            radius={radius}
            acceptedAssets={accepted}
            buttonLabel="Buy lamp"
            showBranding={false}
            onStepChange={onStep}
            onSettled={onSettled}
            className="msite-widget"
          />
        </div>
      </div>
    </div>
  );
}

function HaloLamp() {
  return (
    <svg aria-hidden viewBox="0 0 280 300" className="msite-lamp">
      <defs>
        <radialGradient id="halo-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffc979" stopOpacity="0.62" />
          <stop offset="55%" stopColor="#ff9a3d" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#ff9a3d" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="halo-pool" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffd9a0" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#ffb867" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="halo-brass" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#6e4a22" />
          <stop offset="30%" stopColor="#e3b878" />
          <stop offset="52%" stopColor="#fff0cf" />
          <stop offset="72%" stopColor="#c08f4e" />
          <stop offset="100%" stopColor="#4d3216" />
        </linearGradient>
        <linearGradient id="halo-shade" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#ffb25c" />
          <stop offset="62%" stopColor="#ffdca4" />
          <stop offset="100%" stopColor="#fff6e3" />
        </linearGradient>
      </defs>
      <ellipse cx="140" cy="110" rx="140" ry="110" fill="url(#halo-glow)" />
      <ellipse cx="140" cy="272" rx="128" ry="22" fill="url(#halo-pool)" />
      <rect x="135" y="136" width="10" height="124" fill="url(#halo-brass)" />
      <path d="M92 272c0-9 22-15 48-15s48 6 48 15c0 5-22 9-48 9s-48-4-48-9Z" fill="url(#halo-brass)" />
      <path d="M60 138c0-52 36-88 80-88s80 36 80 88c0 7-36 12-80 12s-80-5-80-12Z" fill="url(#halo-shade)" />
      <ellipse cx="140" cy="139" rx="72" ry="9" fill="#fffbf0" />
      <rect x="133" y="38" width="14" height="14" rx="3" fill="url(#halo-brass)" />
    </svg>
  );
}
