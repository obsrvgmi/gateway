"use client";

import type { CSSProperties, ReactNode } from "react";
import { RiArrowRightLine, RiCheckLine, type RemixiconComponentType } from "@remixicon/react";
import { Radio as AriaRadio, RadioGroup as AriaRadioGroup } from "react-aria-components";
import { TokenMark } from "@/components/brand/token-mark";
import { NavButton } from "@/components/nav-button";
import { ASSETS, RECEIVE_ASSETS } from "@/lib/assets";
import type { AssetSymbol } from "@/lib/types";
import { cx } from "@/utils/cx";
import { Bus } from "./bus";

export interface SceneStep {
  title: string;
  body: string;
  /** The real control for this step, so doing the step is how the visitor learns it. */
  children?: ReactNode;
}

export interface SceneFeature {
  icon: RemixiconComponentType;
  title: string;
  body: string;
}

interface SceneProps {
  id: string;
  title: ReactNode;
  body: string;
  cta: string;
  href: string;
  flip?: boolean;
  /** The product itself, responding to the steps. */
  demo: ReactNode;
  steps: SceneStep[];
  features: SceneFeature[];
}

/**
 * Both products use this one template so they read as a pair and hold one size: how it works
 * (three steps with their controls inside) beside the live product, then what you get.
 */
export function Scene({ id, title, body, cta, href, flip = false, demo, steps, features }: SceneProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cx("scene", flip && "is-flipped")}>
      <div className="scene-head">
        <h2 id={`${id}-title`} className="scene-title">{title}</h2>
        <div className="scene-side">
          <p className="scene-body">{body}</p>
          <NavButton href={href} trailingIcon={RiArrowRightLine} className="scene-cta">{cta}</NavButton>
        </div>
      </div>

      <div className="stage-plate scene-plate product reveal">
        <span aria-hidden className="plate-port is-top"><span className="stage-socket is-main" /></span>
        <span aria-hidden className="plate-port is-bottom"><span className="stage-socket is-main" /></span>

        <div className="product-demo">{demo}</div>

        <div className="product-how">
          <p className="product-label">How it works</p>
          <ol className="steps">
            {steps.map((step, index) => (
              <li key={step.title} className="step">
                <span aria-hidden className="step-number">{index + 1}</span>
                <div className="step-body">
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                  {step.children && <div className="step-control">{step.children}</div>}
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="product-features">
          <p className="product-label">What you get</p>
          <ul className="features">
            {features.map(({ icon: Icon, title: name, body: detail }) => (
              <li key={name} className="feature">
                <Icon className="size-5" aria-hidden />
                <div>
                  <p className="feature-title">{name}</p>
                  <p className="feature-body">{detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <Bus span={96} delay={-1.6} className="bus-stub" />
    </section>
  );
}

/** Equal keys in a milled track. One thumb slides between them, on transforms only. */
export function Segmented({ label, value, options, onChange }: { label: string; value: string; options: { value: string; name: string }[]; onChange: (value: string) => void }) {
  const style = { "--count": options.length, "--index": Math.max(options.findIndex((item) => item.value === value), 0) } as CSSProperties;
  return (
    <AriaRadioGroup aria-label={label} value={value} onChange={onChange} orientation="horizontal" style={style} className="segments">
      <span aria-hidden className="segment-thumb" />
      {options.map((item) => (
        <AriaRadio key={item.value} value={item.value} className={({ isSelected, isFocusVisible }) => cx("segment", isSelected && "is-selected", isFocusVisible && "is-focus")}>
          {item.name}
        </AriaRadio>
      ))}
    </AriaRadioGroup>
  );
}

/** The inside of a coin tile, shared by the single and multiple choice pickers. */
export function CoinFace({ symbol }: { symbol: AssetSymbol }) {
  return (
    <>
      <TokenMark symbol={symbol} size="sm" className="coin-mark" />
      <span className="coin-text">
        <span className="coin-symbol">{symbol}</span>
        <span className="coin-chain">{ASSETS[symbol].chain}</span>
      </span>
      <span aria-hidden className="coin-check"><RiCheckLine className="size-3" /></span>
    </>
  );
}

export const coinClass = ({ isSelected, isFocusVisible }: { isSelected: boolean; isFocusVisible: boolean }) => cx("coin", isSelected && "is-selected", isFocusVisible && "is-focus");

export function ReceivePicker({ value, onChange }: { value: AssetSymbol; onChange: (asset: AssetSymbol) => void }) {
  return (
    <AriaRadioGroup aria-label="Asset you get paid in" value={value} onChange={(next) => onChange(next as AssetSymbol)} orientation="horizontal" className="coins">
      {RECEIVE_ASSETS.map((asset) => (
        <AriaRadio key={asset.symbol} value={asset.symbol} aria-label={asset.symbol} className={coinClass}>
          <CoinFace symbol={asset.symbol} />
        </AriaRadio>
      ))}
    </AriaRadioGroup>
  );
}

