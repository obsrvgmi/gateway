"use client";

import { useMemo, useState } from "react";
import { RiAddLine, RiDeleteBin6Line, RiLayoutMasonryLine, RiPauseLine, RiPencilLine, RiPlayLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { SearchField } from "@/components/base/search-field/search-field";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { toast } from "@/components/base/toast/toast";
import { NavButton } from "@/components/nav-button";
import { formatUsd, formatUsdWhole } from "@/lib/format";
import { sourceTotals, sourceTrend } from "@/lib/metrics";
import { actions, useGateway } from "@/lib/store";
import { embedSnippet } from "@/lib/embed";
import { useOrigin } from "@/lib/use-origin";
import type { Widget, WidgetStatus } from "@/lib/types";
import { cx } from "@/utils/cx";
import { Sparkline } from "../charts";
import { formatCount, plural } from "../fmt";
import { AddTile, Bento, CopyButton, EmptyState, PageHeader, Panel, WidgetStatusChip } from "../ui";

const RADIUS = { rounded: "rounded-xl", soft: "rounded-md", sharp: "rounded-none" };

/** A small drawing of the widget, from its real theme, accent and corners. */
function WidgetThumb({ widget }: { widget: Widget }) {
  const dark = widget.theme === "dark";
  return (
    <div className={cx("flex h-28 items-center justify-center rounded-2xl bg-background-secondary-default", widget.theme === "auto" && "bg-linear-to-r from-background-secondary-default to-background-tertiary-default")} aria-hidden>
      <div className={cx("theme-scope-light flex w-36 flex-col gap-1.5 border border-border-button-default p-2.5 shadow-card", RADIUS[widget.radius], dark ? "bg-text-primary" : "bg-background-primary-default")}>
        <span className={cx("h-1.5 w-16 rounded-full", dark ? "bg-background-primary-default/40" : "bg-background-tertiary-default")} />
        <span className={cx("h-1.5 w-24 rounded-full", dark ? "bg-background-primary-default/25" : "bg-background-secondary-default")} />
        <span className={cx("mt-1 h-5", RADIUS[widget.radius])} style={{ background: widget.accent }} />
      </div>
    </div>
  );
}

export function WidgetsView() {
  const { widgets, payments } = useGateway();
  const origin = useOrigin();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<WidgetStatus | "all">("all");
  const add = <NavButton href="/dashboard/widgets/new" leadingIcon={RiAddLine}>New widget</NavButton>;

  const rows = useMemo(
    () => widgets.map((widget) => ({ widget, totals: sourceTotals(payments, widget.id), trend: sourceTrend(payments, widget.id) })).sort((a, b) => b.totals.volume - a.totals.volume),
    [widgets, payments],
  );

  if (widgets.length === 0) {
    return (
      <>
        <PageHeader title="Widgets" description="Embeddable checkouts for your site or app." actions={add} />
        <Panel><EmptyState icon={RiLayoutMasonryLine} title="No widgets yet" description="Build a checkout that matches your site, then paste one snippet to go live." action={add} /></Panel>
      </>
    );
  }

  const needle = query.trim().toLowerCase();
  const visible = rows.filter(({ widget }) => (tab === "all" || widget.status === tab) && (needle === "" || `${widget.name} ${widget.site}`.toLowerCase().includes(needle)));
  const volume = rows.reduce((sum, row) => sum + row.totals.volume, 0);
  const count = rows.reduce((sum, row) => sum + row.totals.count, 0);

  return (
    <>
      <PageHeader title="Widgets" description="Embeddable checkouts for your site or app." actions={add} />
      <Bento>
        {[
          ["Live widgets", formatCount(widgets.filter((w) => w.status === "live").length), `of ${formatCount(widgets.length)} in total`],
          ["Settled volume", formatUsdWhole(volume), "All time, across widgets"],
          ["Settled payments", formatCount(count), "All time, across widgets"],
          ["Average payment", formatUsd(count ? volume / count : 0), "Across widgets"],
        ].map(([label, value, note]) => (
          <div key={label} className="col-span-6 flex min-w-0 flex-col gap-0.5 rounded-3xl border border-border-button-default bg-background-inner-default p-4 shadow-card @5xl:col-span-3">
            <p className="truncate text-body-regular text-text-secondary">{label}</p>
            <p className="truncate text-title-2-semibold">{value}</p>
            <p className="truncate text-caption-1-regular text-text-secondary">{note}</p>
          </div>
        ))}
      </Bento>

      <div className="flex flex-wrap items-center gap-2">
        <SearchField aria-label="Search widgets" placeholder="Search widgets" value={query} onChange={setQuery} className="min-w-[200px] flex-1" />
        <SegmentedControl aria-label="Filter by status" selectedKeys={[tab]} onSelectionChange={(keys) => { const next = [...keys][0]; if (next) setTab(next as WidgetStatus | "all"); }}>
          <SegmentedControlItem id="all">{`All ${widgets.length}`}</SegmentedControlItem>
          <SegmentedControlItem id="live">{`Live ${widgets.filter((w) => w.status === "live").length}`}</SegmentedControlItem>
          <SegmentedControlItem id="paused">{`Paused ${widgets.filter((w) => w.status === "paused").length}`}</SegmentedControlItem>
        </SegmentedControl>
      </div>

      {visible.length === 0 ? (
        <Panel><EmptyState icon={RiLayoutMasonryLine} title="No widgets match" description="Try a different search or status." action={<Button variant="secondary" onClick={() => { setQuery(""); setTab("all"); }}>Clear filters</Button>} /></Panel>
      ) : (
        <Bento>
          {visible.map(({ widget, totals, trend }) => (
            <Panel key={widget.id} className="col-span-12 gap-3 @xl:col-span-6 @5xl:col-span-4">
              <WidgetThumb widget={widget} />
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                  <h2 className="truncate text-body-semibold" title={widget.name}>{widget.name}</h2>
                  <p className="truncate text-caption-1-regular text-text-secondary" dir="ltr">{widget.site}</p>
                </div>
                <WidgetStatusChip status={widget.status} />
              </div>
              <div className="flex items-end justify-between gap-3 rounded-2xl bg-background-secondary-default p-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-headline-semibold">{formatUsdWhole(totals.volume)}</span>
                  <span className="text-caption-1-regular text-text-secondary tabular-nums">{plural(totals.count, "payment")}, to {widget.receiveAsset}</span>
                </div>
                <Sparkline values={trend} label={`${widget.name}, volume over 30 days`} className="w-20 shrink-0" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <CopyButton text={embedSnippet(origin, widget.id, "html")} label="Embed code" size="small">Copy embed</CopyButton>
                <NavButton href={`/dashboard/widgets/${widget.id}/edit`} variant="secondary" size="small" leadingIcon={RiPencilLine}>Edit</NavButton>
                <span className="ms-auto flex gap-1">
                  <Button
                    variant="ghost"
                    size="small"
                    iconOnly
                    leadingIcon={widget.status === "live" ? RiPauseLine : RiPlayLine}
                    aria-label={`${widget.status === "live" ? "Pause" : "Resume"} ${widget.name}`}
                    onClick={() => actions.updateWidget(widget.id, { status: widget.status === "live" ? "paused" : "live" })}
                  />
                  <Button
                    variant="ghost"
                    size="small"
                    iconOnly
                    leadingIcon={RiDeleteBin6Line}
                    aria-label={`Delete ${widget.name}`}
                    onClick={() => {
                      actions.removeWidget(widget.id);
                      toast.success("Widget deleted", { actions: [{ label: "Undo", onClick: () => actions.addWidget(widget) }] });
                    }}
                  />
                </span>
              </div>
            </Panel>
          ))}
          <AddTile count={visible.length} href="/dashboard/widgets/new" label="Build another widget" icon={RiAddLine} />
        </Bento>
      )}
    </>
  );
}
