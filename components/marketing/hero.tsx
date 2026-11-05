"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { RiArrowDownLine, RiCheckLine, RiPauseLine, RiPlayLine } from "@remixicon/react";
import { Rosette } from "@/components/brand/rosette";
import { TokenMark } from "@/components/brand/token-mark";
import { CHECKOUT_STEPS, CheckoutWidget } from "@/components/checkout/checkout-widget";
import { NavButton } from "@/components/nav-button";
import { ASSETS, RECEIVE_ASSETS, quote } from "@/lib/assets";
import { formatToken } from "@/lib/format";
import { SITE } from "@/lib/site";
import type { AssetSymbol } from "@/lib/types";
import { cx } from "@/utils/cx";
import { FlowChannels } from "./flow-channels";

/** Ordered by hue, so the rail reads as one spectrum and not as a list of colours. */
const SOURCES: AssetSymbol[] = ["BTC", "BNB", "NEAR", "USDT", "ARB", "ETH", "SOL"];
const AMOUNT = 120;

const ink = (symbol: AssetSymbol) => ({ "--ink-light": ASSETS[symbol].ink.light, "--ink-dark": ASSETS[symbol].ink.dark }) as CSSProperties;

export function Hero() {
  const stage = useRef<HTMLElement>(null);
  const [payAsset, setPayAsset] = useState<AssetSymbol>("ETH");
  const [receiveAsset, setReceiveAsset] = useState<AssetSymbol>("USDC");
  const [step, setStep] = useState<number | null>(null);
  const [focus, setFocus] = useState<AssetSymbol | null>(null);
  const [paused, setPaused] = useState(false);
  const [touched, setTouched] = useState(false);
  const locked = step !== null;
  const settled = step === CHECKOUT_STEPS.length;
  const { receiveAmount } = quote(AMOUNT, payAsset, receiveAsset);

  // Until someone takes over, the hero walks through assets so the quote is seen changing.
  useEffect(() => {
    if (touched || paused || locked) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      setPayAsset((current) => SOURCES[(SOURCES.indexOf(current) + 1) % SOURCES.length]);
    }, 3200);
    return () => window.clearInterval(timer);
  }, [touched, paused, locked]);

  return (
    <main ref={stage} onPointerDown={() => setTouched(true)} onKeyDown={() => setTouched(true)} className="stage relative isolate flex min-h-dvh flex-col overflow-hidden">
      <div aria-hidden className="stage-art"><Rosette petals={60} rings={18} inner={6} outer={49} strokeWidth={0.04} /></div>
      <FlowChannels stage={stage} sources={SOURCES} active={payAsset} step={step} focus={focus} paused={paused} />

      <div className="stage-frame">
        <div className="stage-head">
          <h1 className="contents">
            <span className="stage-rise hero-display text-text-primary stage-head-in">Accept<br className="max-lg:hidden" /> any crypto.</span>{" "}
            <span className="stage-rise hero-display text-text-primary stage-head-out" style={{ "--in": "90ms" } as CSSProperties}>Get paid in the<br className="max-lg:hidden" /> asset you want.</span>
          </h1>
          <p className="stage-rise stage-lede stage-lede-in">Share a payment link or embed a checkout. Your customer pays from any chain.</p>
          <p className="stage-rise stage-lede stage-lede-out">It settles to your wallet in the asset you chose. Gateway never holds the funds.</p>
          <p className="stage-rise stage-powered text-body-medium text-text-primary"><span aria-hidden className="stage-powered-dot" />Powered by NEAR Intents</p>
        </div>

        <div className="stage-machine">
          <div role="group" aria-label="Choose an asset to pay with" className="stage-plate stage-rail">
            <p className="stage-caption">Customer pays with</p>
            <PauseButton paused={paused} onToggle={() => setPaused((value) => !value)} />
            <span aria-hidden className="stage-rule" />
            <div className="stage-rail-list">
              {SOURCES.map((symbol, index) => (
                <button
                  key={symbol}
                  type="button"
                  disabled={locked}
                  aria-label={`${symbol}, ${ASSETS[symbol].chain}`}
                  aria-pressed={payAsset === symbol}
                  onClick={() => setPayAsset(symbol)}
                  onPointerEnter={() => setFocus(symbol)}
                  onPointerLeave={() => setFocus(null)}
                  onFocus={() => setFocus(symbol)}
                  onBlur={() => setFocus(null)}
                  style={{ ...ink(symbol), "--in": `${260 + index * 60}ms` } as CSSProperties}
                  className="stage-row"
                >
                  <TokenMark symbol={symbol} size="sm" />
                  <span className="stage-row-symbol">{symbol}</span>
                  <span className="stage-row-note">{ASSETS[symbol].chain}</span>
                  <span aria-hidden data-flow-pin={symbol} style={ink(symbol)} className={cx("stage-socket stage-pin", payAsset === symbol && "is-active")} />
                </button>
              ))}
            </div>
          </div>

          <div className="stage-dock">
            <span aria-hidden className="stage-port">
              {SOURCES.map((symbol) => (
                <span key={symbol} data-flow-dock={symbol} style={ink(symbol)} className={cx("stage-socket", payAsset === symbol && "is-active")} />
              ))}
            </span>
            <CheckoutWidget
              merchant={SITE.merchant}
              title="Order #4821"
              amount={AMOUNT}
              receiveAsset={receiveAsset}
              payAsset={payAsset}
              showAssetPicker={false}
              onPayAssetChange={setPayAsset}
              onStepChange={(next) => { setTouched(true); setStep(next); }}
              className="stage-card"
            />
            <span aria-hidden className="stage-port is-output"><span data-flow-out className="stage-socket is-main" /></span>
          </div>

          <div className={cx("stage-plate stage-sink", settled && "is-settled")}>
            <span aria-hidden className="stage-port is-output"><span data-flow-sink className="stage-socket is-main" /></span>
            <p className="stage-caption">{settled ? `Settled to ${SITE.merchant}` : `${SITE.merchant} receives`}</p>
            <span aria-hidden className="stage-rule" />
            <div className="stage-amount">
              <span className="stage-amount-mark">
                <span aria-hidden className="stage-seal"><Rosette petals={14} rings={4} strokeWidth={0.55} inner={34} outer={50} /></span>
                <TokenMark symbol={receiveAsset} size="lg" />
              </span>
              <span className="stage-amount-value">
                <span className="truncate tabular-nums">{formatToken(receiveAmount, receiveAsset).split(" ")[0]}</span>
                <span className="stage-row-note">{receiveAsset} on {ASSETS[receiveAsset].chain}</span>
              </span>
            </div>
            <span aria-hidden className="stage-rule" />
            <div role="group" aria-label="Choose the asset you get paid in" className="stage-settle-list">
              {RECEIVE_ASSETS.map((asset) => (
                <button
                  key={asset.symbol}
                  type="button"
                  disabled={locked}
                  aria-label={`Get paid in ${asset.name}`}
                  aria-pressed={receiveAsset === asset.symbol}
                  onClick={() => setReceiveAsset(asset.symbol)}
                  className="stage-row"
                >
                  <TokenMark symbol={asset.symbol} size="sm" />
                  <span className="stage-row-symbol">{asset.symbol}</span>
                  <span className="stage-row-check">{receiveAsset === asset.symbol && <RiCheckLine className="size-4" aria-hidden />}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="stage-foot">
          <a href="#products" className="stage-link stage-rise-late"><RiArrowDownLine className="size-4" aria-hidden />Payment Links and Widgets</a>
          <div className="stage-rise-late stage-actions">
            <div className="flex flex-wrap justify-center gap-2">
              <NavButton href="/dashboard/links/new" className="stage-cta">Create Payment Link</NavButton>
              <NavButton href="/dashboard/widgets/new" variant="secondary" className="stage-cta">View Widget Demo</NavButton>
            </div>
            <ul className="stage-trust text-body-medium text-text-secondary">
              <li>{SITE.chainsSupported} chains</li>
              <li>{SITE.settlement} settlement</li>
              <li>Non-custodial</li>
            </ul>
          </div>
          <PauseButton paused={paused} onToggle={() => setPaused((value) => !value)} />
        </div>
      </div>
    </main>
  );
}

/** Rendered twice, in the foot on desktop and on the rail on phones; CSS shows one of them. */
function PauseButton({ paused, onToggle }: { paused: boolean; onToggle: () => void }) {
  return (
    <button type="button" aria-label={paused ? "Play background animation" : "Pause background animation"} aria-pressed={paused} onClick={onToggle} className="stage-pause">
      {paused ? <RiPlayLine className="size-4" aria-hidden /> : <RiPauseLine className="size-4" aria-hidden />}
    </button>
  );
}
