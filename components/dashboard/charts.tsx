"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { formatUsd, formatUsdWhole } from "@/lib/format";
import { TokenMark } from "@/components/brand/token-mark";
import type { Share } from "@/lib/metrics";
import type { AssetSymbol } from "@/lib/types";
import { cx } from "@/utils/cx";
import { formatCompactUsd, formatCount, formatPercent, plural } from "./fmt";
import { preloadVolumeChart } from "./preload";

export type { VolumeMetric } from "./volume-chart";

export const assetColor = (asset: string) => `var(--viz-${asset}, var(--viz-other))`;
/** These hues are too light to carry white labels. */
export const assetDarkInk = (asset: string) => ["SOL", "BNB", "NEAR"].includes(asset);

/** A partial period is left out by the caller, so a trend never ends on a false drop. */
export function Sparkline({ values, label, className }: { values: number[]; label: string; className?: string }) {
  const width = 100;
  const height = 32;
  if (values.length < 2) return <div className={cx("h-8", className)} aria-hidden />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const spread = max - min || 1;
  const point = (value: number, index: number) => [(index / (values.length - 1)) * width, height - 3 - ((value - min) / spread) * (height - 6)] as const;
  const path = values.map((value, index) => point(value, index).map((n) => n.toFixed(2)).join(",")).join(" ");
  const [endX, endY] = point(values[values.length - 1], values.length - 1);
  return (
    <div className={cx("relative h-8", className)} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="size-full overflow-visible text-foreground-icon-tertiary" aria-hidden>
        <polyline points={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <span aria-hidden className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-(--viz-primary) ring-2 ring-background-primary-default" style={{ left: `${endX}%`, top: `${(endY / height) * 100}%` }} />
    </div>
  );
}

/** Recharts is by far the largest thing on a dashboard route, and only this chart uses it. The box is the same either way. */
export const VolumeChart = dynamic(() => preloadVolumeChart().then((module) => module.VolumeChart), {
  ssr: false,
  loading: () => <div aria-hidden className="relative min-h-64 min-w-0 flex-1 animate-pulse rounded-xl bg-background-secondary-default motion-reduce:animate-none @3xl:min-h-72" />,
});

export function LegendKey({ kind, children }: { kind: "bar" | "line" | "partial"; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-caption-1-regular text-text-secondary">
      {kind === "line" ? <span aria-hidden className="h-0.5 w-3 rounded-full bg-foreground-icon-tertiary" /> : <span aria-hidden className={cx("size-2.5 rounded-xs bg-(--viz-primary)", kind === "partial" && "opacity-40")} />}
      {children}
    </span>
  );
}

/** One whole split into parts. Each part prints its share only when the label fits. */
export function SegmentBar({ parts, label }: { parts: { key: string; share: number; color: string; name: string; darkInk?: boolean }[]; label: string }) {
  return (
    <div role="img" aria-label={`${label}: ${parts.map((part) => `${part.name} ${formatPercent(part.share, 0)}`).join(", ")}`} className="flex h-7 w-full gap-0.5 overflow-hidden rounded-md">
      {parts.filter((part) => part.share > 0).map((part) => (
        <span key={part.key} title={`${part.name}: ${formatPercent(part.share)}`} className={cx("flex min-w-0 items-center overflow-hidden ps-1.5 text-caption-1-medium tabular-nums", part.darkInk ? "text-text-on-accent" : "text-white")} style={{ width: `${part.share * 100}%`, background: part.color }}>
          {part.share >= 0.1 ? formatPercent(part.share, 0) : null}
        </span>
      ))}
    </div>
  );
}

export function RankBars({ rows }: { rows: { key: string; label: string; value: string; share: number; icon?: AssetSymbol; color?: string; href?: string }[] }) {
  const top = Math.max(...rows.map((row) => row.share), 0.0001);
  return (
    <ul className="flex flex-col gap-0.5">
      {rows.map((row) => {
        const body = (
          <>
            {row.icon && <TokenMark symbol={row.icon} size="sm" />}
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-body-medium">{row.label}</span>
                <span className="shrink-0 text-body-regular text-text-secondary tabular-nums">{row.value}</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-background-secondary-default">
                <div className="h-full rounded-full" style={{ width: `${(row.share / top) * 100}%`, background: row.color ?? "var(--viz-primary)" }} />
              </div>
            </div>
          </>
        );
        return (
          <li key={row.key}>
            {row.href ? (
              <Link href={row.href} className="-mx-1.5 flex items-center gap-2.5 rounded-lg px-1.5 py-1 outline-none hover:bg-background-secondary-default focus-visible:ring-2 focus-visible:ring-border-focus-ring">{body}</Link>
            ) : (
              <div className="flex items-center gap-2.5 py-1">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** One balance, three states, one hue: solid is final, lighter is waiting, hatched is still moving. */
export function BalanceBar({ available, held, arriving }: { available: number; held: number; arriving: number }) {
  const total = available + held + arriving;
  if (total <= 0) return <div className="dash-well h-3 rounded-full" aria-hidden />;
  const share = (value: number) => `${Math.max((value / total) * 100, value > 0 ? 1.2 : 0)}%`;
  return (
    <div role="img" aria-label={`Available ${formatUsd(available)}, on hold ${formatUsd(held)}, arriving ${formatUsd(arriving)}`} className="flex h-3 w-full gap-0.5">
      {available > 0 && <span className="rounded-s-full bg-(--viz-primary)" style={{ width: share(available) }} />}
      {held > 0 && <span className="bg-(--viz-primary) opacity-45" style={{ width: share(held) }} />}
      {arriving > 0 && <span className="dash-hatch rounded-e-full" style={{ width: share(arriving) }} />}
    </div>
  );
}

/** The top of the axis: a round 1, 2 or 5 step above the largest value, so the ticks read as plain figures. */
function niceCeiling(value: number) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((candidate) => candidate * magnitude >= value) ?? 10;
  return step * magnitude;
}

/** One series on one axis, oldest first. A day with no sent runs has no bar, and the history table holds every value. */
export function PayoutBars({ rows }: { rows: { key: string; label: string; usd: number; count: number }[] }) {
  const [active, setActive] = useState<number | null>(null);
  const top = niceCeiling(Math.max(...rows.map((row) => row.usd), 1));
  const ticks = [top, top / 2, 0];
  const shown = active === null ? null : rows[active];
  const anchors = rows.length > 2 ? [0, Math.floor((rows.length - 1) / 2), rows.length - 1] : rows.map((_, index) => index);

  return (
    <div
      role="group"
      tabIndex={0}
      aria-label={`Paid out, ${rows.length} recent runs, ${rows[0].label} to ${rows[rows.length - 1].label}. Use the arrow keys to read each run.`}
      onFocus={() => setActive((index) => index ?? rows.length - 1)}
      onBlur={() => setActive(null)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const move = event.key === "ArrowRight" ? 1 : -1;
        setActive((index) => Math.min(rows.length - 1, Math.max(0, (index ?? rows.length - 1) + move)));
      }}
      className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background-inner-default"
    >
      <div aria-hidden className="flex h-28 flex-col justify-between text-end text-caption-2-regular text-text-secondary tabular-nums">
        {ticks.map((tick, index) => <span key={tick} className={cx("leading-none", index === 0 ? "-mt-px" : index === 2 ? "-mb-px" : "")}>{formatCompactUsd(tick)}</span>)}
      </div>
      <div className="relative h-28">
        {ticks.map((tick) => <span key={tick} aria-hidden className="absolute inset-x-0 h-px bg-separator-border" style={{ bottom: `${(tick / top) * 100}%` }} />)}
        <ul className="absolute inset-0 flex items-stretch" onPointerLeave={() => setActive(null)}>
          {rows.map((row, index) => (
            <li key={row.key} onPointerEnter={() => setActive(index)} className="flex min-w-0 flex-1 flex-col justify-end px-px">
              <span className={cx("block rounded-t-[4px] bg-(--viz-primary) transition-opacity duration-100", active !== null && active !== index && "opacity-45")} style={{ height: `${Math.max((row.usd / top) * 100, row.usd ? 2 : 0)}%` }} />
              <span className="sr-only">{row.label}: {formatUsd(row.usd)}</span>
            </li>
          ))}
        </ul>
        {shown && active !== null && (
          <div role="status" className="pointer-events-none absolute -top-2 z-10 flex w-max -translate-y-full flex-col rounded-xl border border-border-button-default bg-background-primary-default px-2.5 py-1.5 shadow-dropdown" style={active < rows.length / 2 ? { left: `${((active + 0.5) / rows.length) * 100}%` } : { right: `${100 - ((active + 0.5) / rows.length) * 100}%` }}>
            <span className="text-caption-1-regular text-text-secondary">{shown.label}</span>
            <span className="text-body-semibold tabular-nums">{formatUsd(shown.usd)}</span>
            <span className="text-caption-1-regular text-text-secondary tabular-nums">{plural(shown.count, "asset")} sent</span>
          </div>
        )}
      </div>
      <span aria-hidden />
      <div aria-hidden className="relative h-4 text-caption-2-regular text-text-secondary">
        {anchors.map((index, position) => (
          <span key={rows[index].key} className={cx("absolute top-0 whitespace-nowrap", position === 0 ? "start-0" : position === anchors.length - 1 ? "end-0" : "start-1/2 -translate-x-1/2 rtl:translate-x-1/2")}>{rows[index].label}</span>
        ))}
      </div>
    </div>
  );
}

export function Histogram({ bins }: { bins: { label: string; short: string; count: number }[] }) {
  const top = Math.max(...bins.map((bin) => bin.count), 1);
  return (
    <ul className="flex min-h-32 flex-1 items-stretch gap-1.5" aria-label="Payments by settlement time">
      {bins.map((bin) => (
        <li key={bin.label} className="flex min-w-0 flex-1 flex-col justify-end gap-1" title={`${bin.label}: ${formatCount(bin.count)} payments`}>
          <span className="text-center text-caption-2-medium text-text-secondary tabular-nums">{formatCount(bin.count)}</span>
          <span className="block rounded-t-sm bg-(--viz-primary)" style={{ height: `${Math.max((bin.count / top) * 62, bin.count ? 3 : 0)}%` }} />
          <span className="border-t border-separator-border pt-1 text-center text-caption-2-regular text-text-secondary"><span className="sr-only">{bin.label}</span><span aria-hidden>{bin.short}</span></span>
        </li>
      ))}
    </ul>
  );
}

const HOURS = ["00", "03", "06", "09", "12", "15", "18", "21"];

export function Heatmap({ cells, weekdays, max }: { cells: number[][]; weekdays: string[]; max: number }) {
  return (
    <div className="grid grid-cols-[auto_repeat(8,minmax(0,1fr))] gap-1" aria-hidden>
      <span />
      {HOURS.map((hour) => <span key={hour} className="text-center text-caption-2-medium text-text-secondary tabular-nums">{hour}</span>)}
      {cells.map((row, day) => [
        <span key={weekdays[day]} className="pe-1 text-caption-2-medium text-text-secondary">{weekdays[day]}</span>,
        ...row.map((count, block) => (
          <span
            key={`${day}-${block}`}
            title={`${weekdays[day]} ${HOURS[block]}:00 UTC: ${formatCount(count)} payments`}
            className="h-5 rounded-xs"
            style={{ background: count ? `color-mix(in srgb, var(--viz-primary) ${Math.round(12 + (count / (max || 1)) * 88)}%, transparent)` : "var(--color-background-secondary-default)" }}
          />
        )),
      ])}
    </div>
  );
}

type Flow = { key: string; pay: AssetSymbol; receive: AssetSymbol; volume: number };

/** The product in one picture: any asset in, the merchant's asset out. Ribbon width is settled volume. */
export function RouteFlow({ flows, pay, receive, hrefFor }: { flows: Flow[]; pay: Share<AssetSymbol>[]; receive: Share<AssetSymbol>[]; hrefFor?: (asset: AssetSymbol) => string }) {
  const [focus, setFocus] = useState<AssetSymbol | null>(null);
  const gap = 6;
  // Every asset gets a slot tall enough for its label, however little volume it carried.
  const slotMin = 30;
  const usable = 230;
  const total = pay.reduce((sum, item) => sum + item.volume, 0) || 1;

  const layout = (items: Share<AssetSymbol>[]) => {
    let y = 0;
    const nodes = new Map(items.map((item) => {
      const size = Math.max((item.volume / total) * usable, 2);
      const slot = Math.max(size, slotMin);
      const node = { y: y + (slot - size) / 2, size, slot, top: y };
      y += slot + gap;
      return [item.key, node];
    }));
    return { nodes, height: y - gap };
  };
  const { nodes: left, height: leftHeight } = layout(pay);
  const { nodes: right, height: rightHeight } = layout(receive);
  const height = Math.max(leftHeight, rightHeight, usable);
  const leftUsed = new Map<string, number>();
  const rightUsed = new Map<string, number>();

  const ribbons = [...flows]
    .sort((a, b) => pay.findIndex((item) => item.key === a.pay) - pay.findIndex((item) => item.key === b.pay) || receive.findIndex((item) => item.key === a.receive) - receive.findIndex((item) => item.key === b.receive))
    .flatMap((flow) => {
      const from = left.get(flow.pay);
      const to = right.get(flow.receive);
      if (!from || !to) return [];
      const fromTotal = pay.find((item) => item.key === flow.pay)?.volume ?? 1;
      const toTotal = receive.find((item) => item.key === flow.receive)?.volume ?? 1;
      const fromSize = (flow.volume / fromTotal) * from.size;
      const toSize = (flow.volume / toTotal) * to.size;
      const y0 = from.y + (leftUsed.get(flow.pay) ?? 0);
      const y1 = to.y + (rightUsed.get(flow.receive) ?? 0);
      leftUsed.set(flow.pay, (leftUsed.get(flow.pay) ?? 0) + fromSize);
      rightUsed.set(flow.receive, (rightUsed.get(flow.receive) ?? 0) + toSize);
      const d = `M0,${y0} C50,${y0} 50,${y1} 100,${y1} L100,${y1 + toSize} C50,${y1 + toSize} 50,${y0 + fromSize} 0,${y0 + fromSize} Z`;
      return [{ ...flow, d }];
    });

  const Label = ({ item, y, size, side }: { item: Share<AssetSymbol>; y: number; size: number; side: "left" | "right" }) => (
    <div className={cx("absolute inset-x-0 flex -translate-y-1/2 items-center gap-1.5", side === "right" && "flex-row-reverse text-end")} style={{ top: y + size / 2 }} onPointerEnter={() => side === "left" && setFocus(item.key)} onPointerLeave={() => setFocus(null)}>
      <TokenMark symbol={item.key} size="sm" />
      <span className="flex min-w-0 flex-col">
        {side === "left" && hrefFor ? <Link href={hrefFor(item.key)} className="rounded text-caption-1-semibold leading-tight outline-none hover:underline focus-visible:ring-2 focus-visible:ring-border-focus-ring">{item.key}</Link> : <span className="text-caption-1-semibold leading-tight">{item.key}</span>}
        <span className="truncate text-caption-2-regular text-text-secondary tabular-nums">{formatCompactUsd(item.volume)}</span>
      </span>
    </div>
  );

  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)_76px] gap-1.5 @lg:grid-cols-[96px_minmax(0,1fr)_96px]">
      <div className="relative" style={{ height }}>
        {pay.map((item) => { const node = left.get(item.key)!; return <Label key={item.key} item={item} y={node.y} size={node.size} side="left" />; })}
      </div>
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height }} className="w-full" role="img" aria-label={`Settled volume by route, totalling ${formatUsdWhole(total)}. Each asset's total is listed beside the diagram.`}>
        {ribbons.map((ribbon) => (
          <path key={ribbon.key} d={ribbon.d} fill={assetColor(ribbon.pay)} className="transition-opacity duration-150" opacity={focus === null ? 0.42 : focus === ribbon.pay ? 0.8 : 0.1} onPointerEnter={() => setFocus(ribbon.pay)} onPointerLeave={() => setFocus(null)}>
            <title>{`${ribbon.pay} to ${ribbon.receive}: ${formatUsdWhole(ribbon.volume)}`}</title>
          </path>
        ))}
      </svg>
      <div className="relative" style={{ height }}>
        {receive.map((item) => { const node = right.get(item.key)!; return <Label key={item.key} item={item} y={node.y} size={node.size} side="right" />; })}
      </div>
    </div>
  );
}
