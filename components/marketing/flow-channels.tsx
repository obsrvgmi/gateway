"use client";

import { useEffect, useState, type CSSProperties, type RefObject } from "react";
import { CHECKOUT_STEPS } from "@/components/checkout/checkout-widget";
import { ASSETS } from "@/lib/assets";
import type { AssetSymbol } from "@/lib/types";
import { cx } from "@/utils/cx";

type Point = [number, number];

export interface FlowChannelsProps {
  /** Holds [data-flow-pin=SYMBOL], [data-flow-dock=SYMBOL], [data-flow-out] and [data-flow-sink]. */
  stage: RefObject<HTMLElement | null>;
  sources: AssetSymbol[];
  active: AssetSymbol;
  /** Null while choosing, the running step, or CHECKOUT_STEPS.length once settled. */
  step: number | null;
  focus: AssetSymbol | null;
  paused: boolean;
}

interface Layout {
  width: number;
  height: number;
  inputs: string[];
  output: string;
}

/** Corner radius of every bend, so the whole bus turns with one tool. */
const BEND_RADIUS = 16;
const TAN_22_5 = Math.tan(Math.PI / 8);
const COS_45 = Math.SQRT1_2;
const round = (value: number) => Number(value.toFixed(3));

/**
 * A PCB trace: straight, one 45 degree jog at `middle` with constant-radius corners, straight.
 * All lanes share `middle`, so equal pitch in gives equal pitch through the jog and no lane can
 * cross another. Work is done in along/across coordinates so one router serves both layouts.
 */
function route(from: Point, to: Point, middle: number, vertical: boolean) {
  const out = ([along, across]: Point) => (vertical ? `${round(across)} ${round(along)}` : `${round(along)} ${round(across)}`);
  const start: Point = vertical ? [from[1], from[0]] : from;
  const end: Point = vertical ? [to[1], to[0]] : to;
  const drop = end[1] - start[1];
  const run = Math.abs(drop);
  if (run < 0.5) return `M${out(start)}L${out(end)}`;
  const sign = Math.sign(drop);
  const near = middle - run / 2;
  const far = middle + run / 2;
  const radius = Math.min(BEND_RADIUS, (run * Math.SQRT2) / (2 * TAN_22_5));
  const tangent = radius * TAN_22_5;
  const slant = tangent * COS_45;
  // Swapping the axes mirrors the page, which reverses the direction each corner turns.
  const turn = (sign > 0) !== vertical ? 1 : 0;
  return [
    `M${out(start)}`,
    `L${out([near - tangent, start[1]])}`,
    `A${round(radius)} ${round(radius)} 0 0 ${turn} ${out([near + slant, start[1] + sign * slant])}`,
    `L${out([far - slant, end[1] - sign * slant])}`,
    `A${round(radius)} ${round(radius)} 0 0 ${1 - turn} ${out([far + tangent, end[1]])}`,
    `L${out(end)}`,
  ].join("");
}

function measure(host: HTMLElement, sources: AssetSymbol[]): Layout | null {
  const frame = host.getBoundingClientRect();
  const centre = (selector: string): Point | null => {
    const rect = host.querySelector(selector)?.getBoundingClientRect();
    return rect ? [rect.left - frame.left + rect.width / 2, rect.top - frame.top + rect.height / 2] : null;
  };
  const start = centre("[data-flow-out]");
  const end = centre("[data-flow-sink]");
  const pins = sources.map((symbol) => centre(`[data-flow-pin="${symbol}"]`));
  const docks = sources.map((symbol) => centre(`[data-flow-dock="${symbol}"]`));
  if (!start || !end || pins.some((pin) => !pin) || docks.some((dock) => !dock)) return null;
  const vertical = Math.abs(end[1] - start[1]) > Math.abs(end[0] - start[0]);
  const along = vertical ? 1 : 0;
  const middle = ((pins[0] as Point)[along] + (docks[0] as Point)[along]) / 2;
  return {
    width: frame.width,
    height: frame.height,
    inputs: sources.map((_, index) => route(pins[index] as Point, docks[index] as Point, middle, vertical)),
    output: route(start, end, 0, vertical),
  };
}

/** Longest first. Stacked dashes ending at one point give a tail that fades without a gradient. */
const PULSE_LAYERS = ["flow-tail-3", "flow-tail-2", "flow-tail-1", "flow-head"];

export function Channel({ d, delay, className, style }: { d: string; delay: number; className?: string; style?: CSSProperties }) {
  return (
    <g className={cx("flow-lane", className)} style={{ ...style, "--delay": `${delay}s` } as CSSProperties}>
      <path d={d} className="flow-edge" />
      <path d={d} className="flow-wall" />
      <path d={d} className="flow-floor" />
      <path d={d} pathLength={1} className="flow-lit" />
      {PULSE_LAYERS.map((layer) => <path key={layer} d={d} pathLength={1} className={cx("flow-pulse", layer)} />)}
    </g>
  );
}

/**
 * The channels are grooves cut into the stage. They sit under the plates, so each one is lost
 * under its socket's ring and the junction has no seam, while its geometry runs to the exact
 * centre of the node. Everything that moves is a CSS animation on the pulse and lit layers,
 * driven by `data-state`, so nothing here runs per frame in JavaScript.
 */
export function FlowChannels({ stage, sources, active, step, focus, paused }: FlowChannelsProps) {
  const [layout, setLayout] = useState<Layout | null>(null);

  useEffect(() => {
    const host = stage.current;
    if (!host) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setLayout(measure(host, sources)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(host);
    host.querySelectorAll(".stage-plate, .stage-card").forEach((element) => observer.observe(element));
    void document.fonts?.ready.then(update);

    // Set on the art alone: on the stage, each move restyles every element in the hero.
    const art = host.querySelector<HTMLElement>(".stage-art");
    let tilt = 0;
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === "touch" || tilt) return;
      const { clientX, clientY } = event;
      tilt = requestAnimationFrame(() => {
        tilt = 0;
        const rect = host.getBoundingClientRect();
        art?.style.setProperty("--px", (((clientX - rect.left) / rect.width - 0.5) * 2).toFixed(3));
        art?.style.setProperty("--py", (((clientY - rect.top) / rect.height - 0.5) * 2).toFixed(3));
      });
    };
    host.addEventListener("pointermove", onMove);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(tilt);
      observer.disconnect();
      host.removeEventListener("pointermove", onMove);
    };
  }, [stage, sources]);

  if (!layout) return null;
  const state = step === null ? "idle" : step === CHECKOUT_STEPS.length ? "done" : (["confirm", "route", "settle"][step] ?? "idle");
  const timing = { "--route-ms": `${CHECKOUT_STEPS[1].ms}ms`, "--settle-ms": `${CHECKOUT_STEPS[2].ms}ms` } as CSSProperties;

  return (
    <svg aria-hidden data-state={state} width={layout.width} height={layout.height} style={timing} className={cx("flow-channels", paused && "is-paused", focus && "has-focus")}>
      {layout.inputs.map((d, index) => {
        const symbol = sources[index];
        return (
          <Channel
            key={symbol}
            d={d}
            delay={-index * 0.8}
            className={cx(symbol === active && "is-active", symbol === focus && "is-focus")}
            style={{ "--ink-light": ASSETS[symbol].ink.light, "--ink-dark": ASSETS[symbol].ink.dark } as CSSProperties}
          />
        );
      })}
      <Channel d={layout.output} delay={-0.4} className="is-output" />
    </svg>
  );
}
