"use client";

import { useId, useMemo } from "react";
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatUsd } from "@/lib/format";
import type { Bucket } from "@/lib/metrics";
import { formatCompactUsd, formatCount } from "./fmt";

function VolumeTooltip({ active, payload, previousLabel }: { active?: boolean; payload?: { payload: Bucket }[]; previousLabel: string }) {
  const bucket = payload?.[0]?.payload;
  if (!active || !bucket) return null;
  return (
    <div className="flex min-w-44 flex-col gap-1 rounded-xl border border-border-button-default bg-background-primary-default p-3 shadow-dropdown">
      <p className="text-caption-1-medium text-text-secondary">{bucket.span}</p>
      <p className="text-headline-semibold tabular-nums">{formatUsd(bucket.current.volume)}</p>
      <p className="text-caption-1-regular text-text-secondary tabular-nums">{formatCount(bucket.current.count)} settled</p>
      <p className="text-caption-1-regular text-text-secondary tabular-nums">{previousLabel}: {formatUsd(bucket.previous.volume)}</p>
    </div>
  );
}

export type VolumeMetric = "volume" | "count";

/** One axis, whichever metric: count and volume never share a chart. A bar opens that period's payments. */
export function VolumeChart({ buckets, previousLabel, metric = "volume", compare = true, onSelect }: { buckets: Bucket[]; previousLabel: string; metric?: VolumeMetric; compare?: boolean; onSelect?: (bucket: Bucket) => void }) {
  const pattern = useId().replaceAll(":", "");
  const data = useMemo(() => buckets.map((bucket) => ({ ...bucket, value: bucket.current[metric], prior: bucket.previous[metric] })), [buckets, metric]);
  const every = buckets.length > 14 ? 5 : buckets.length > 12 ? 2 : 0;
  return (
    <div className="relative min-h-64 min-w-0 flex-1 @3xl:min-h-72 @ultra:min-h-[max(20rem,30dvh)]" role="img" aria-label={`Settled volume by period. Switch to the table view for every value.`}>
      <div className="absolute inset-0"><ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
          <defs>
            <pattern id={pattern} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--viz-primary)" opacity="0.2" />
              <rect width="2" height="6" fill="var(--viz-primary)" opacity="0.65" />
            </pattern>
            <linearGradient id={`${pattern}-fill`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--viz-primary)" />
              <stop offset="100%" stopColor="var(--viz-primary)" stopOpacity="0.62" />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--color-separator-border)" />
          <XAxis dataKey="label" interval={every ? every - 1 : 0} tickLine={false} axisLine={false} tick={{ fill: "var(--color-text-secondary)", fontSize: 12 }} tickMargin={8} />
          <YAxis width={48} tickLine={false} axisLine={false} tick={{ fill: "var(--color-text-secondary)", fontSize: 12 }} tickFormatter={(value: number) => (metric === "volume" ? formatCompactUsd(value) : formatCount(value))} />
          <Tooltip cursor={{ fill: "var(--color-background-secondary-default)" }} content={<VolumeTooltip previousLabel={previousLabel} />} isAnimationActive={false} />
          <Bar dataKey="value" maxBarSize={22} radius={[5, 5, 1, 1]} isAnimationActive={false} className={onSelect ? "cursor-pointer" : undefined} onClick={(entry) => onSelect?.((entry as unknown as { payload: Bucket }).payload)}>
            {data.map((bucket) => <Cell key={bucket.key} fill={`url(#${pattern}${bucket.partial ? "" : "-fill"})`} />)}
          </Bar>
          {compare && <Line dataKey="prior" type="monotone" stroke="var(--color-text-tertiary)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />}
        </ComposedChart>
      </ResponsiveContainer></div>
    </div>
  );
}
