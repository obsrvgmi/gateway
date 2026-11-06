"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { RiArrowDownSLine, RiArrowRightSLine, RiArrowUpSLine, RiCheckLine, RiCheckboxCircleLine, RiCloseLine, RiErrorWarningLine, RiInformationLine, RiLayoutMasonryLine, RiLinksLine, RiTimeLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Meter } from "@/components/base/meter/meter";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { Switch } from "@/components/base/switch/switch";
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@/components/base/table/table";
import { toast } from "@/components/base/toast/toast";
import { TokenMark } from "@/components/brand/token-mark";
import { NavButton } from "@/components/nav-button";
import { ASSETS } from "@/lib/assets";
import { attentionItems, type AttentionItem } from "@/lib/attention";
import { formatToken, formatUsd, formatUsdWhole } from "@/lib/format";
import { assetMix, activityGrid, chainMix, channelMix, leaderboard, percentDelta, pointDelta, RANGES, rangeReport, receiveMix, routeFlows, secondsDelta, settleByAsset, settleHistogram, type Bucket, type RangeKey } from "@/lib/metrics";
import { actions, useGateway } from "@/lib/store";
import type { GatewayState, Payment } from "@/lib/types";
import { cx } from "@/utils/cx";
import { assetColor, assetDarkInk, Heatmap, Histogram, LegendKey, RankBars, RouteFlow, SegmentBar, Sparkline, VolumeChart, type VolumeMetric } from "../charts";
import { formatCompactUsd, formatCount, formatPercent, formatSeconds, plural, relativeTime } from "../fmt";
import { preloadPaymentDrawer } from "../preload";
import { PositionStrip } from "../position-strip";
import { Bento, DeltaChip, NoData, PageHeader, Panel, PanelLink, PaymentStatusChip, Stat, useWideMain } from "../ui";

const PaymentDrawer = dynamic(() => preloadPaymentDrawer().then((module) => module.PaymentDrawer), { ssr: false });

function setupSteps({ links, widgets, payments, settings, settlement }: GatewayState) {
  return [
    { label: "Connect your settlement wallet", done: settlement.wallet !== null, href: "/dashboard/settings?tab=business" },
    { label: "Create a payment link", done: links.length > 0, href: "/dashboard/links/new" },
    { label: "Build a checkout widget", done: widgets.length > 0, href: "/dashboard/widgets/new" },
    { label: "Take your first payment", done: payments.some((p) => p.status === "settled"), href: "/dashboard/links" },
    { label: "Connect a webhook", done: settings.webhooks.some((hook) => hook.enabled), href: "/dashboard/settings?tab=developers" },
    { label: "Invite a teammate", done: settings.team.filter((member) => member.status === "active").length > 1, href: "/dashboard/settings?tab=team" },
  ];
}

function Kpi({ label, value, delta, upIsGood, trend, trendLabel, href }: { label: string; value: string; delta: Parameters<typeof DeltaChip>[0]["delta"]; upIsGood?: boolean; trend: number[]; trendLabel: string; href: string }) {
  return (
    <Stat label={label} value={value} href={href}>
      <div className="flex items-center justify-between gap-2">
        <DeltaChip delta={delta} upIsGood={upIsGood} />
        <Sparkline values={trend} label={trendLabel} className="w-16 min-w-0" />
      </div>
    </Stat>
  );
}

const TONES: Record<AttentionItem["tone"], { icon: typeof RiTimeLine; className: string }> = {
  critical: { icon: RiErrorWarningLine, className: "bg-status-rose-background text-status-rose-text" },
  warning: { icon: RiTimeLine, className: "bg-status-yellow-background text-status-yellow-text" },
  info: { icon: RiInformationLine, className: "bg-background-secondary-default text-foreground-icon-secondary" },
};

function Attention({ items }: { items: AttentionItem[] }) {
  return (
    <Panel title="Needs you" description={items.length ? undefined : "Nothing is waiting on you."} className="gap-2">
      {items.length === 0 ? (
        <p className="flex items-center gap-2 text-body-regular text-text-secondary"><RiCheckboxCircleLine className="size-5 text-text-accent" aria-hidden />All clear.</p>
      ) : (
        <ul className="-mx-1.5 flex flex-col">
          {items.slice(0, 4).map((item) => {
            const { icon: Icon, className } = TONES[item.tone];
            return (
              <li key={item.id}>
                <Link href={item.href} className="flex items-center gap-2.5 rounded-xl p-1.5 outline-none hover:bg-background-secondary-default focus-visible:ring-2 focus-visible:ring-border-focus-ring">
                  <span className={cx("flex size-8 shrink-0 items-center justify-center rounded-lg", className)}><Icon className="size-4.5" aria-hidden /></span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body-medium">{item.title}</span>
                    <span className="truncate text-caption-1-regular text-text-secondary">{item.detail}</span>
                  </span>
                  <RiArrowRightSLine className="size-4 shrink-0 text-foreground-icon-tertiary rtl:rotate-180" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function LiveFeed({ payments, now, onOpen }: { payments: Payment[]; now: number; onOpen: (id: string) => void }) {
  // Only payments that arrive after mount animate in. The class has no effect once a row has mounted.
  const [initial] = useState(() => new Set(payments.map((p) => p.id)));
  const recent = payments.slice(0, 12);

  const inFlight = payments.filter((p) => p.status === "processing").length;
  return (
    <Panel
      title="Live activity"
      description={inFlight ? `${inFlight} in flight` : "Nothing in flight"}
      className="min-h-[320px] flex-1 gap-3"
    >
      <div className="relative min-h-0 flex-1">
        <ul className="absolute inset-0 flex flex-col divide-y divide-separator-border overflow-y-auto">
          {recent.map((payment) => (
            <li key={payment.id} className={cx(!initial.has(payment.id) && "dash-enter")}>
              <button type="button" onClick={() => onOpen(payment.id)} className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg py-2 text-start outline-none hover:bg-background-secondary-default focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-border-focus-ring">
                <span className={cx("shrink-0", payment.status === "processing" && "dash-pulse")}><TokenMark symbol={payment.payAsset} /></span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body-medium">{payment.sourceName}</span>
                  <span className="truncate text-caption-1-regular text-text-secondary tabular-nums">{formatToken(payment.payAmount, payment.payAsset)}, {relativeTime(payment.createdAt, now)}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="text-body-medium tabular-nums">{formatUsd(payment.usd)}</span>
                  <span className="[&>span]:px-1 [&>span]:py-0 [&>span]:text-caption-2-medium"><PaymentStatusChip status={payment.status} /></span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

const MORE_INSIGHTS = 7;

function SetupCard({ steps, full }: { steps: ReturnType<typeof setupSteps>; full?: boolean }) {
  const done = steps.filter((step) => step.done).length;
  return (
    <ol className={cx("grid gap-2", full ? "grid-cols-1 @2xl:grid-cols-2" : "grid-cols-1 @2xl:grid-cols-2 @5xl:grid-cols-6")} aria-label={`${done} of ${steps.length} setup steps done`}>
      {steps.map((step) => (
        <li key={step.label}>
          <Link href={step.href} className="flex h-full items-center gap-2 rounded-xl bg-background-secondary-default p-2.5 text-body-medium outline-none hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring">
            <span className={cx("flex size-5 shrink-0 items-center justify-center rounded-full", step.done ? "bg-status-lime-background text-status-lime-text" : "border border-border-button-default")}>
              {step.done && <RiCheckLine className="size-3.5" aria-hidden />}
            </span>
            <span className={cx("min-w-0", step.done && "text-text-secondary")}>{step.label}{step.done && <span className="sr-only"> (done)</span>}</span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

export function OverviewView() {
  const state = useGateway();
  const { payments, links, widgets, settings, setupDismissed } = state;
  const [range, setRange] = useState<RangeKey>("30d");
  const [view, setView] = useState<"chart" | "table">("chart");
  const [metric, setMetric] = useState<VolumeMetric>("volume");
  const [compare, setCompare] = useState(true);
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  // On a phone the page leads with what needs a decision, and the breakdowns wait behind one control.
  const wide = useWideMain();
  const [showMore, setShowMore] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const [drawerArmed, setDrawerArmed] = useState(false);
  if (openId && !drawerArmed) setDrawerArmed(true);

  const report = useMemo(() => rangeReport(payments, range), [payments, range]);
  const steps = setupSteps(state);
  const stepsDone = steps.filter((step) => step.done).length;

  const { summary, previous, buckets, list, now } = report;
  const complete = buckets.filter((bucket) => !bucket.partial);
  const previousList = useMemo(() => {
    const first = buckets[0];
    const last = buckets[buckets.length - 1];
    return payments.filter((p) => { const t = new Date(p.createdAt).getTime(); return t >= first.from - (last.to - first.from) && t < first.from; });
  }, [payments, buckets]);
  const assets = useMemo(() => assetMix(list), [list]);
  const receive = useMemo(() => receiveMix(list), [list]);
  const flows = useMemo(() => routeFlows(list), [list]);
  const chains = useMemo(() => chainMix(list), [list]);
  const channels = useMemo(() => channelMix(list), [list]);
  const leaders = useMemo(() => leaderboard(list, previousList).slice(0, 6), [list, previousList]);
  const histogram = useMemo(() => settleHistogram(list), [list]);
  const slowest = useMemo(() => settleByAsset(list), [list]);
  const grid = useMemo(() => activityGrid(list), [list]);
  const attention = useMemo(() => attentionItems(state, report.now), [state, report.now]);
  const rangeDays = range === "12m" ? 365 : Number.parseInt(range, 10);
  const inRange = `range=${rangeDays}`;
  const openBucket = (bucket: Bucket) => router.push(`/dashboard/payments?from=${bucket.from}&to=${bucket.to}&label=${encodeURIComponent(bucket.span)}`);
  const rangeLong = RANGES.find((item) => item.key === range)?.long ?? "";
  const previousLabel = range === "12m" ? "Year earlier" : "Prior period";
  const linkShare = channels.find((c) => c.key === "link");
  const widgetShare = channels.find((c) => c.key === "widget");
  const fresh = payments.length === 0;

  const header = (
    <PageHeader
      title="Overview"
      description={`${settings.businessName}, settling in ${settings.receiveAsset}.`}
      actions={
        <>
          {!fresh && (
            <SegmentedControl aria-label="Time range" selectedKeys={[range]} onSelectionChange={(keys) => { const next = [...keys][0]; if (next) setRange(next as RangeKey); }}>
              {RANGES.map((item) => <SegmentedControlItem key={item.key} id={item.key}>{item.label}</SegmentedControlItem>)}
            </SegmentedControl>
          )}
        </>
      }
    />
  );

  if (fresh) {
    return (
      <>
        {header}
        <Bento>
          <Panel title="Get set up" description={`${stepsDone} of ${steps.length} done. Your numbers appear here once payments land.`} className="col-span-12 @5xl:col-span-8">
            <Meter aria-label="Setup progress" value={stepsDone} maxValue={steps.length} />
            <SetupCard steps={steps} full />
          </Panel>
          <Panel title="Start taking payments" description="Links work anywhere you can paste a URL. Widgets sit on your own site." className="col-span-12 @5xl:col-span-4">
            <div className="flex flex-col gap-2">
              <NavButton href="/dashboard/links/new" leadingIcon={RiLinksLine}>Create your first link</NavButton>
              <NavButton href="/dashboard/widgets/new" variant="secondary" leadingIcon={RiLayoutMasonryLine}>Build a widget</NavButton>
            </div>
            <p className="text-body-regular text-text-secondary">No payments yet. Volume, routes and settlement times appear as soon as one lands.</p>
          </Panel>
        </Bento>
      </>
    );
  }

  return (
    <>
      {header}
      {!setupDismissed && stepsDone < steps.length && (
        <Panel
          title={`Finish setting up: ${stepsDone} of ${steps.length} done`}
          actions={<Button variant="ghost" size="small" iconOnly leadingIcon={RiCloseLine} aria-label="Dismiss setup checklist" onClick={() => { actions.dismissSetup(); toast("Setup checklist hidden", { actions: [{ label: "Undo", onClick: () => actions.showSetup() }] }); }} />}
          className="gap-3"
        >
          {wide || showSteps ? <SetupCard steps={steps} /> : (
            <>
              <Meter aria-label="Setup progress" value={stepsDone} maxValue={steps.length} />
              <Button variant="ghost" size="small" onClick={() => setShowSteps(true)} className="self-start">Show the steps</Button>
            </>
          )}
        </Panel>
      )}
      <PositionStrip />
      <Bento className="grid-flow-row-dense">
        <Panel className="col-span-12 @5xl:col-span-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="text-body-regular text-text-secondary">{metric === "volume" ? "Settled volume" : "Settled payments"}, {rangeLong}</h2>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-display-3-semibold tracking-[-0.02em] tabular-nums [overflow-wrap:anywhere]">{metric === "volume" ? formatUsdWhole(summary.volume) : formatCount(summary.count)}</p>
                <DeltaChip delta={metric === "volume" ? percentDelta(summary.volume, previous.volume) : percentDelta(summary.count, previous.count)} />
              </div>
              <p className="text-caption-1-regular text-text-secondary">Against the same days one period earlier. Select a bar to see its payments.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Switch size="sm" isSelected={compare} onChange={setCompare} aria-label="Compare with the prior period">Compare</Switch>
              <SegmentedControl aria-label="Chart metric" selectedKeys={[metric]} onSelectionChange={(keys) => { const next = [...keys][0]; if (next) setMetric(next as VolumeMetric); }}>
                <SegmentedControlItem id="volume">Volume</SegmentedControlItem>
                <SegmentedControlItem id="count">Count</SegmentedControlItem>
              </SegmentedControl>
              <SegmentedControl aria-label="Volume view" selectedKeys={[view]} onSelectionChange={(keys) => { const next = [...keys][0]; if (next) setView(next as "chart" | "table"); }}>
                <SegmentedControlItem id="chart">Chart</SegmentedControlItem>
                <SegmentedControlItem id="table">Table</SegmentedControlItem>
              </SegmentedControl>
            </div>
          </div>
          {view === "chart" ? (
            <>
              <VolumeChart buckets={buckets} previousLabel={previousLabel} metric={metric} compare={compare} onSelect={openBucket} />
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                <LegendKey kind="bar">{metric === "volume" ? "Settled volume" : "Settled payments"}</LegendKey>
                <LegendKey kind="partial">{`${buckets[buckets.length - 1].label} so far`}</LegendKey>
                {compare && <LegendKey kind="line">{previousLabel}</LegendKey>}
              </div>
            </>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <Table aria-label="Settled volume by period" size="sm">
                <TableHeader>
                  <TableColumn isRowHeader>Period</TableColumn>
                  <TableColumn>Volume</TableColumn>
                  <TableColumn>Settled</TableColumn>
                  <TableColumn>{previousLabel}</TableColumn>
                </TableHeader>
                <TableBody>
                  {buckets.map((bucket) => (
                    <TableRow key={bucket.key} id={bucket.key}>
                      <TableCell><Link href={`/dashboard/payments?from=${bucket.from}&to=${bucket.to}&label=${encodeURIComponent(bucket.span)}`} className="rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-border-focus-ring">{bucket.span}</Link></TableCell>
                      <TableCell className="tabular-nums">{formatUsd(bucket.current.volume)}</TableCell>
                      <TableCell className="tabular-nums">{formatCount(bucket.current.count)}</TableCell>
                      <TableCell className="tabular-nums">{formatUsd(bucket.previous.volume)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Panel>

        <div className="col-span-12 flex min-w-0 flex-col gap-3 @3xl:gap-4 @5xl:col-span-4">
          <Attention items={attention} />
          <LiveFeed payments={payments} now={now} onOpen={setOpenId} />
        </div>

        <Kpi label="Settled payments" value={formatCount(summary.count)} delta={percentDelta(summary.count, previous.count)} trend={complete.map((b) => b.current.count)} trendLabel="Settled payments trend" href={`/dashboard/payments?status=settled&${inRange}`} />
        <Kpi label="Success rate" value={formatPercent(summary.successRate)} delta={pointDelta(summary.successRate, previous.successRate)} trend={complete.map((b) => b.current.successRate ?? 0)} trendLabel="Success rate trend" href={`/dashboard/payments?status=expired&${inRange}`} />
        <Kpi label="Avg settlement" value={formatSeconds(summary.avgSettle)} delta={secondsDelta(summary.avgSettle, previous.avgSettle)} upIsGood={false} trend={complete.map((b) => b.current.avgSettle ?? 0)} trendLabel="Average settlement trend" href={`/dashboard/payments?status=settled&${inRange}`} />
        <Kpi label="Customer route fees" value={formatUsd(summary.fees)} delta={percentDelta(summary.fees, previous.fees)} upIsGood={false} trend={complete.map((b) => b.current.fees)} trendLabel="Route fee trend" href={`/dashboard/payments?status=settled&${inRange}`} />

        {!wide && (
          <div className="col-span-12 flex justify-center">
            <Button variant="secondary" trailingIcon={showMore ? RiArrowUpSLine : RiArrowDownSLine} aria-expanded={showMore} onClick={() => setShowMore((open) => !open)} className="w-full">{showMore ? "Hide breakdowns" : `Show ${MORE_INSIGHTS} breakdowns`}</Button>
          </div>
        )}
        {(wide || showMore) && <>
        <Panel title="Any asset in, your asset out" description="Where settled volume came from and what it became. Select an asset to see its payments." className="col-span-12 @5xl:col-span-7">
          {flows.length ? <RouteFlow flows={flows} pay={assets} receive={receive} hrefFor={(asset) => `/dashboard/payments?asset=${asset}&${inRange}`} /> : <NoData>No settled payments in this range.</NoData>}
        </Panel>
        <Panel title="Paid with" description={`${assets.length} assets across ${chains.length} chains`} className="col-span-12 @2xl:col-span-6 @5xl:col-span-5">
          {assets.length ? (
            <>
              <SegmentBar label="Paid-with share of volume" parts={assets.map((a) => ({ key: a.key, share: a.share, color: assetColor(a.key), name: ASSETS[a.key].name, darkInk: assetDarkInk(a.key) }))} />
              <RankBars rows={assets.slice(0, 6).map((a) => ({ key: a.key, label: ASSETS[a.key].name, value: `${formatCompactUsd(a.volume)}, ${formatPercent(a.share, 0)}`, share: a.share, icon: a.key, color: assetColor(a.key), href: `/dashboard/payments?asset=${a.key}&${inRange}` }))} />
            </>
          ) : <NoData>No settled payments in this range.</NoData>}
        </Panel>

        <Panel title="Top earners" description={`By settled volume, ${rangeLong}, against the prior period`} actions={<PanelLink href="/dashboard/links">All links</PanelLink>} className="col-span-12 @5xl:col-span-7">
          {leaders.length ? (
            <ol className="flex flex-col divide-y divide-separator-border">
              {leaders.map((leader, index) => (
                <li key={leader.key} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                  <span className="w-4 shrink-0 text-center text-caption-1-medium text-text-secondary tabular-nums">{index + 1}</span>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-background-secondary-default">
                    {leader.type === "link" ? <RiLinksLine className="size-4 text-foreground-icon-secondary" aria-hidden /> : <RiLayoutMasonryLine className="size-4 text-foreground-icon-secondary" aria-hidden />}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <Link href={`/dashboard/payments?source=${leader.key}`} className="truncate rounded text-body-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-border-focus-ring">{leader.name}</Link>
                    <span className="text-caption-1-regular text-text-secondary tabular-nums">{plural(leader.count, "payment")}, {formatPercent(leader.share, 0)} of volume</span>
                  </span>
                  <span className="hidden shrink-0 @lg:inline-flex"><DeltaChip delta={leader.delta} /></span>
                  <span className="w-20 shrink-0 text-end text-body-medium tabular-nums">{formatCompactUsd(leader.volume)}</span>
                </li>
              ))}
            </ol>
          ) : <NoData>No settled payments in this range.</NoData>}
        </Panel>
        <Panel title="Settlement speed" description="Quote to wallet" className="col-span-12 @2xl:col-span-6 @5xl:col-span-5">
          <dl className="grid grid-cols-3 gap-2">
            {[["Median", summary.avgSettle === null ? "No data" : `${summary.p50}s`], ["95th percentile", summary.avgSettle === null ? "No data" : `${summary.p95}s`], ["Slowest asset", slowest[0] ? `${slowest[0].asset}, ${slowest[0].average.toFixed(0)}s` : "No data"]].map(([label, value]) => (
              <div key={label} className="flex min-w-0 flex-col rounded-xl bg-background-secondary-default p-2.5">
                <dt className="truncate text-caption-1-regular text-text-secondary">{label}</dt>
                <dd className="truncate text-body-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          <Histogram bins={histogram} />
        </Panel>

        <Panel title="Chains" description="Settled volume by source chain" className="col-span-12 @2xl:col-span-6 @5xl:col-span-4">
          {chains.length ? <RankBars rows={chains.slice(0, 5).map((c) => ({ key: c.key, label: c.key, value: `${formatCompactUsd(c.volume)}, ${formatPercent(c.share, 0)}`, share: c.share, href: `/dashboard/payments?chain=${encodeURIComponent(c.key)}&${inRange}` }))} /> : <NoData>No settled payments in this range.</NoData>}
        </Panel>
        <Panel title="Links and widgets" description="Which product brings in the money" actions={<PanelLink href={`/dashboard/payments?${inRange}`}>Payments</PanelLink>} className="col-span-12 @2xl:col-span-6 @5xl:col-span-4">
          <SegmentBar label="Volume by product" parts={[{ key: "link", share: linkShare?.share ?? 0, color: "var(--viz-primary)", name: "Payment links", darkInk: true }, { key: "widget", share: widgetShare?.share ?? 0, color: "var(--viz-ETH)", name: "Widgets" }]} />
          <dl className="grid grid-cols-2 gap-2">
            {[["Payment links", linkShare, links.filter((l) => l.status === "active").length, "active", "link"], ["Widgets", widgetShare, widgets.filter((w) => w.status === "live").length, "live", "widget"]].map(([label, share, live, word, type]) => (
              <Link key={label as string} href={`/dashboard/payments?type=${type}&${inRange}`} className="dash-well flex min-w-0 flex-col rounded-xl p-2.5 outline-none hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring">
                <dt className="truncate text-caption-1-regular text-text-secondary">{label as string}</dt>
                <dd className="truncate text-body-semibold">{formatCompactUsd((share as typeof linkShare)?.volume ?? 0)}</dd>
                <dd className="truncate text-caption-1-regular text-text-secondary tabular-nums">{plural((share as typeof linkShare)?.count ?? 0, "payment")}, {live as number} {word as string}</dd>
              </Link>
            ))}
          </dl>
        </Panel>
        <Panel title="When customers pay" description={grid.max ? `Busiest: ${grid.weekdays[grid.peak.day]} around ${String(grid.peak.block * 3).padStart(2, "0")}:00 UTC` : "No settled payments in this range"} className="col-span-12 @5xl:col-span-4">
          <Heatmap cells={grid.cells} weekdays={grid.weekdays} max={grid.max} />
        </Panel>
        </>}
      </Bento>
      {drawerArmed && <PaymentDrawer paymentId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

