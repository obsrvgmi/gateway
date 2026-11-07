"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { Selection, SortDescriptor } from "react-aria-components";
import { today, getLocalTimeZone } from "@internationalized/date";
import { RiArrowGoBackLine, RiDownload2Line, RiExchangeDollarLine, RiFileCopyLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import type { DateRangeValue } from "@/components/base/date-picker/date-range-picker";
import { Pagination } from "@/components/base/pagination/pagination";
import { SearchField } from "@/components/base/search-field/search-field";
import { Select, SelectItem } from "@/components/base/select/select";
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@/components/base/table/table";
import { Tag, TagGroup } from "@/components/base/tag-group/tag-group";
import { toast } from "@/components/base/toast/toast";
import { TokenMark } from "@/components/brand/token-mark";
import { NavButton } from "@/components/nav-button";
import { ASSETS, PAY_ASSETS } from "@/lib/assets";
import { formatToken, formatUsd, formatUsdWhole, shortAddress } from "@/lib/format";
import { assetMix, metricsNow, statusCounts, summarize } from "@/lib/metrics";
import { useGateway } from "@/lib/store";
import { RefundDialog } from "../refund-dialog";
import type { AssetSymbol, Payment, PaymentStatus } from "@/lib/types";
import { cx } from "@/utils/cx";
import { RankBars, assetColor } from "../charts";
import { downloadCsv } from "../csv";
import { formatCompactUsd, formatCount, formatPercent, formatRowDate, formatSeconds } from "../fmt";
import { preloadPaymentDrawer } from "../preload";
import { Bento, copyText, EmptyState, MAIN_ULTRA, MAIN_WIDE, PageHeader, Panel, PAYMENT_STATUS_LABEL, PaymentStatusChip, Stat, useMainAtLeast, useWideMain } from "../ui";

const PaymentDrawer = dynamic(() => preloadPaymentDrawer().then((module) => module.PaymentDrawer), { ssr: false });
// Motion and the calendar load with the "Custom range" option, not with the page.
const DateRangePicker = dynamic(() => import("@/components/base/date-picker/date-range-picker").then((module) => module.DateRangePicker), { ssr: false, loading: () => <div aria-hidden className="h-10 w-56 rounded-xl bg-background-secondary-default" /> });

const PAGE_SIZE = 12;
/** A larger display has the height for more rows, and paging less is the point of the room. */
const PAGE_SIZE_ROOMY = 16;
const PAGE_SIZE_ULTRA = 20;
const DAY = 86_400_000;
const STATUSES: PaymentStatus[] = ["settled", "processing", "refunded", "failed", "expired"];
const PRESETS = [["all", "Any time"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["custom", "Custom range"]] as const;
/** `custom-days` and `window` only arrive from Overview links, so they have no entry in the menu. */
type Preset = (typeof PRESETS)[number][0] | "custom-days" | "window";
type SourceFilter = "all" | "link" | "widget";

const SORTERS: Record<string, (a: Payment, b: Payment) => number> = {
  source: (a, b) => a.sourceName.localeCompare(b.sourceName),
  usd: (a, b) => a.usd - b.usd,
  status: (a, b) => a.status.localeCompare(b.status),
  date: (a, b) => a.createdAt.localeCompare(b.createdAt),
};

const utc = (date: DateRangeValue["start"]) => Date.UTC(date.year, date.month - 1, date.day);

function SortLabel({ children, direction }: { children: string; direction?: "ascending" | "descending" }) {
  return <span className="inline-flex items-center gap-1">{children}<span aria-hidden className="w-3 text-text-secondary">{direction === "ascending" ? "↑" : direction === "descending" ? "↓" : ""}</span></span>;
}

const presetFrom = (days: string | null): Preset => (days === "7" || days === "30" || days === "90" ? days : days ? "custom-days" : "all");

export function PaymentsView() {
  const { payments } = useGateway();
  const params = useSearchParams();
  const wide = useWideMain();
  // More room means more of each payment, not longer gaps between the same five columns.
  const roomy = useMainAtLeast(MAIN_WIDE);
  const ultra = useMainAtLeast(MAIN_ULTRA);
  const pageSize = ultra ? PAGE_SIZE_ULTRA : roomy ? PAGE_SIZE_ROOMY : PAGE_SIZE;
  // Every filter can arrive in the URL, so a figure elsewhere can open exactly the rows behind it.
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [status, setStatus] = useState<PaymentStatus | "all">((params.get("status") as PaymentStatus | null) ?? "all");
  const [asset, setAsset] = useState<AssetSymbol | "all">((params.get("asset") as AssetSymbol | null) ?? "all");
  const [source, setSource] = useState<SourceFilter>((params.get("type") as SourceFilter | null) ?? "all");
  const [sourceId, setSourceId] = useState<string | null>(params.get("source"));
  const [chain, setChain] = useState<string | null>(params.get("chain"));
  const [span] = useState(() => {
    const from = Number(params.get("from"));
    const to = Number(params.get("to"));
    return from && to ? { from, to, label: params.get("label") ?? "Selected period" } : null;
  });
  const [preset, setPreset] = useState<Preset>(span ? "window" : presetFrom(params.get("range")));
  const [custom, setCustom] = useState<DateRangeValue | null>(null);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [drawerArmed, setDrawerArmed] = useState(false);
  if (openId && !drawerArmed) setDrawerArmed(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [refunding, setRefunding] = useState(false);
  const [sort, setSort] = useState<SortDescriptor>({ column: "date", direction: "descending" });

  const now = metricsNow(payments);
  const dateBounds = useMemo((): [number, number] | null => {
    if (preset === "window" && span) return [span.from, span.to];
    if (preset === "custom") return custom ? [utc(custom.start), utc(custom.end) + DAY] : null;
    if (preset === "all") return null;
    const days = Number(preset === "custom-days" ? params.get("range") : preset);
    return [now - now % DAY - (days - 1) * DAY, Infinity];
  }, [preset, custom, now, span, params]);

  // Everything but status and asset, so each facet can show what picking it would give.
  const scoped = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return payments.filter((p) => {
      const time = new Date(p.createdAt).getTime();
      return (
        (source === "all" || p.sourceType === source) &&
        (sourceId === null || p.sourceId === sourceId) &&
        (chain === null || ASSETS[p.payAsset].chain === chain) &&
        (dateBounds === null || (time >= dateBounds[0] && time < dateBounds[1])) &&
        (needle === "" || [p.id, p.sourceName, p.payAsset, p.payer].some((field) => field.toLowerCase().includes(needle)))
      );
    });
  }, [payments, query, source, sourceId, chain, dateBounds]);

  const filtered = useMemo(() => scoped.filter((p) => (status === "all" || p.status === status) && (asset === "all" || p.payAsset === asset)), [scoped, status, asset]);
  const sorted = useMemo(() => {
    const compare = SORTERS[String(sort.column)] ?? SORTERS.date;
    const list = [...filtered].sort(compare);
    return sort.direction === "descending" ? list.reverse() : list;
  }, [filtered, sort]);

  const summary = useMemo(() => summarize(filtered), [filtered]);
  const counts = useMemo(() => statusCounts(scoped.filter((p) => asset === "all" || p.payAsset === asset)), [scoped, asset]);
  const assets = useMemo(() => assetMix(filtered), [filtered]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const rows = sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const sourceName = sourceId ? payments.find((p) => p.sourceId === sourceId)?.sourceName ?? sourceId : null;
  const chips = [
    status !== "all" && { id: "status", label: `Status: ${PAYMENT_STATUS_LABEL(status)}` },
    asset !== "all" && { id: "asset", label: `Paid with: ${asset}` },
    source !== "all" && { id: "source", label: source === "link" ? "Payment links" : "Widgets" },
    sourceName && { id: "sourceId", label: `Source: ${sourceName}` },
    chain && { id: "chain", label: `Chain: ${chain}` },
    preset === "window" && span && { id: "date", label: span.label },
    preset === "custom-days" && { id: "date", label: `Last ${params.get("range")} days` },
    preset !== "all" && preset !== "window" && preset !== "custom-days" && (preset !== "custom" || custom) && { id: "date", label: preset === "custom" ? "Custom dates" : PRESETS.find(([key]) => key === preset)?.[1] ?? "" },
    query.trim() && { id: "query", label: `Search: ${query.trim()}` },
  ].filter((chip): chip is { id: string; label: string } => Boolean(chip));

  const resetSelection = () => { setPage(1); setSelected(new Set()); };
  const removeChip = (id: string) => {
    if (id === "status") setStatus("all");
    if (id === "asset") setAsset("all");
    if (id === "source") setSource("all");
    if (id === "sourceId") setSourceId(null);
    if (id === "chain") setChain(null);
    if (id === "date") { setPreset("all"); setCustom(null); }
    if (id === "query") setQuery("");
    resetSelection();
  };
  const clear = () => chips.forEach((chip) => removeChip(chip.id));

  // Selection can span pages, so only this page's rows are replaced.
  const onSelection = (keys: Selection) => {
    const next = new Set(selected);
    rows.forEach((row) => next.delete(row.id));
    (keys === "all" ? rows.map((row) => row.id) : [...keys].map(String)).forEach((id) => next.add(id));
    setSelected(next);
  };
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (!next.delete(id)) next.add(id);
    setSelected(next);
  };

  const selectedRows = useMemo(() => payments.filter((p) => selected.has(p.id)), [payments, selected]);
  const refundable = selectedRows.filter((p) => p.status === "settled");
  const exportRows = (list: Payment[]) => {
    downloadCsv(list);
    toast.success(`Exported ${formatCount(list.length)} payments`, { id: "export", description: "payments.csv is in your downloads." });
  };

  if (payments.length === 0) {
    return (
      <>
        <PageHeader title="Payments" description="Everything paid through your links and widgets." />
        <Panel>
          <EmptyState icon={RiExchangeDollarLine} title="No payments yet" description="Share a payment link to take your first payment." action={<NavButton href="/dashboard/links/new">Create payment link</NavButton>} />
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Payments"
        description={`${formatCount(payments.length)} payments through your links and widgets. All times are UTC.`}
        actions={<Button variant="secondary" leadingIcon={RiDownload2Line} disabled={filtered.length === 0} onClick={() => exportRows(sorted)}>Export CSV</Button>}
      />
      <Bento className="@wide:grid-rows-[auto_1fr]">
        <div className="contents @wide:col-span-3 @wide:col-start-10 @wide:row-start-1 @wide:grid @wide:grid-cols-2 @wide:gap-4">
        {[
          ["Settled volume", formatUsdWhole(summary.volume), `${formatCount(summary.count)} of ${formatCount(summary.total)} payments`],
          ["Success rate", formatPercent(summary.successRate), `${formatCount(summary.inFlightCount)} still in flight`],
          ["Avg settlement", formatSeconds(summary.avgSettle), summary.avgSettle === null ? "Nothing settled" : `95% within ${summary.p95}s`],
          ["Average payment", formatUsd(summary.avgTicket), `${formatCount(summary.payers)} unique payers`],
        ].map(([label, value, note]) => (
          <Stat key={label} label={label} value={value} note={note} className="@wide:col-span-1" />
        ))}
        </div>

        <Panel className="col-span-12 gap-3 p-3 @3xl:p-3 @5xl:col-span-9 @wide:col-start-1 @wide:row-span-2 @wide:row-start-1">
          <div className="flex flex-wrap items-center gap-2">
            <SearchField aria-label="Search payments" placeholder="Search ID, source, asset or payer" value={query} onChange={(value) => { setQuery(value); resetSelection(); }} className="min-w-[200px] flex-1" />
            <Select aria-label="Filter by date" selectedKey={preset === "window" || preset === "custom-days" ? "custom" : preset} onSelectionChange={(key) => { setPreset(key as Preset); resetSelection(); }}>
              {PRESETS.map(([id, label]) => <SelectItem key={id} id={id} textValue={label}>{label}</SelectItem>)}
            </Select>
            <Select aria-label="Filter by status" selectedKey={status} onSelectionChange={(key) => { setStatus(key as PaymentStatus | "all"); resetSelection(); }}>
              {[<SelectItem key="all" id="all" textValue="All statuses">All statuses</SelectItem>, ...STATUSES.map((id) => <SelectItem key={id} id={id} textValue={PAYMENT_STATUS_LABEL(id)}>{PAYMENT_STATUS_LABEL(id)}</SelectItem>)]}
            </Select>
            <Select aria-label="Filter by asset" selectedKey={asset} onSelectionChange={(key) => { setAsset(key as AssetSymbol | "all"); resetSelection(); }}>
              {[<SelectItem key="all" id="all" textValue="All assets">All assets</SelectItem>, ...PAY_ASSETS.map((item) => <SelectItem key={item.symbol} id={item.symbol} textValue={item.symbol}>{item.symbol}</SelectItem>)]}
            </Select>
            <Select aria-label="Filter by source" selectedKey={source} onSelectionChange={(key) => { setSource(key as SourceFilter); resetSelection(); }}>
              <SelectItem id="all" textValue="All sources">All sources</SelectItem>
              <SelectItem id="link" textValue="Payment links">Payment links</SelectItem>
              <SelectItem id="widget" textValue="Widgets">Widgets</SelectItem>
            </Select>
            {preset === "custom" && <DateRangePicker aria-label="Custom date range" value={custom} onChange={(value) => { setCustom(value); resetSelection(); }} defaultValue={{ start: today(getLocalTimeZone()).subtract({ days: 14 }), end: today(getLocalTimeZone()) }} />}
          </div>

          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <TagGroup aria-label="Active filters" size="small" onRemove={(keys) => [...keys].forEach((key) => removeChip(String(key)))}>
                {chips.map((chip) => <Tag key={chip.id} id={chip.id} textValue={chip.label}>{chip.label}</Tag>)}
              </TagGroup>
              <Button variant="ghost" size="small" onClick={clear}>Clear all</Button>
            </div>
          )}

          {selected.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-background-secondary-default p-2" role="status">
              <span className="px-1 text-body-medium tabular-nums">{formatCount(selected.size)} selected, {formatUsd(selectedRows.reduce((sum, p) => sum + p.usd, 0))}</span>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="small" leadingIcon={RiDownload2Line} onClick={() => exportRows(selectedRows)}>Export</Button>
                <Button variant="secondary" size="small" leadingIcon={RiFileCopyLine} onClick={() => copyText(selectedRows.map((p) => p.id).join("\n"), "Payment IDs")}>Copy IDs</Button>
                <Button variant="secondary" size="small" leadingIcon={RiArrowGoBackLine} disabled={refundable.length !== 1} onClick={() => setRefunding(true)}>Refund</Button>
                <Button variant="ghost" size="small" onClick={() => setSelected(new Set())}>Deselect</Button>
              </div>
            </div>
          )}

          {rows.length === 0 ? (
            <EmptyState icon={RiExchangeDollarLine} title="No payments match" description="Try a different search or clear your filters." action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />
          ) : (
            <>
              {wide ? (
                <Table
                  aria-label="Payments"
                  size="sm"
                  selectionMode="multiple"
                  selectionBehavior="toggle"
                  selectedKeys={new Set(rows.filter((row) => selected.has(row.id)).map((row) => row.id))}
                  onSelectionChange={onSelection}
                  sortDescriptor={sort}
                  onSortChange={(next) => { setSort(next); setPage(1); }}
                  onRowAction={(key) => setOpenId(String(key))}
                >
                  <TableHeader>
                    <TableColumn aria-label="Select"><Checkbox slot="selection" size="sm" /></TableColumn>
                    <TableColumn id="source" isRowHeader allowsSorting>{({ sortDirection }) => <SortLabel direction={sortDirection}>Source</SortLabel>}</TableColumn>
                    {ultra && <TableColumn>ID</TableColumn>}
                    <TableColumn>Route</TableColumn>
                    {roomy && <TableColumn>Chain</TableColumn>}
                    <TableColumn id="usd" allowsSorting>{({ sortDirection }) => <SortLabel direction={sortDirection}>Amount</SortLabel>}</TableColumn>
                    <TableColumn id="status" allowsSorting>{({ sortDirection }) => <SortLabel direction={sortDirection}>Status</SortLabel>}</TableColumn>
                    {roomy && <TableColumn>Payer</TableColumn>}
                    {ultra && <TableColumn>Settled in</TableColumn>}
                    <TableColumn id="date" allowsSorting>{({ sortDirection }) => <SortLabel direction={sortDirection}>Date (UTC)</SortLabel>}</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {rows.map((payment) => (
                      <TableRow key={payment.id} id={payment.id} className="cursor-pointer hover:bg-background-secondary-default">
                        <TableCell><Checkbox slot="selection" size="sm" /></TableCell>
                        <TableCell><span className="block max-w-[220px] min-w-28 whitespace-normal text-body-medium text-text-primary">{payment.sourceName}</span></TableCell>
                        {ultra && <TableCell><span dir="ltr" className="whitespace-nowrap text-caption-1-regular text-text-secondary tabular-nums">{payment.id}</span></TableCell>}
                        <TableCell>
                          <span className="flex items-center gap-2 whitespace-nowrap tabular-nums">
                            <TokenMark symbol={payment.payAsset} size="sm" />
                            {formatToken(payment.payAmount, payment.payAsset)}
                            <span className="text-text-secondary">to {payment.receiveAsset}</span>
                          </span>
                        </TableCell>
                        {roomy && <TableCell className="whitespace-nowrap">{ASSETS[payment.payAsset].chain}</TableCell>}
                        <TableCell className="whitespace-nowrap tabular-nums">{formatUsd(payment.usd)}</TableCell>
                        <TableCell><PaymentStatusChip status={payment.status} /></TableCell>
                        {roomy && <TableCell><span dir="ltr" className="whitespace-nowrap tabular-nums">{shortAddress(payment.payer)}</span></TableCell>}
                        {ultra && <TableCell className="whitespace-nowrap tabular-nums">{payment.settleSeconds === null ? <span className="text-text-secondary">Not settled</span> : formatSeconds(payment.settleSeconds)}</TableCell>}
                        <TableCell className="whitespace-nowrap tabular-nums">{formatRowDate(payment.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
              <ul className="flex flex-col divide-y divide-separator-border" aria-label="Payments list">
                {rows.map((payment) => (
                  <li key={payment.id} className="flex items-center gap-2 py-1">
                    <Checkbox size="sm" aria-label={`Select ${payment.sourceName}, ${formatUsd(payment.usd)}`} isSelected={selected.has(payment.id)} onChange={() => toggleOne(payment.id)} />
                    <button type="button" onClick={() => setOpenId(payment.id)} className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg py-1.5 text-start outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring">
                      <TokenMark symbol={payment.payAsset} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-body-medium">{payment.sourceName}</span>
                        <span className="text-caption-1-regular text-text-secondary tabular-nums">{formatToken(payment.payAmount, payment.payAsset)}, {formatRowDate(payment.createdAt)}</span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-0.5">
                        <span className="text-body-medium tabular-nums">{formatUsd(payment.usd)}</span>
                        <PaymentStatusChip status={payment.status} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              )}

              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 px-1">
                <p className="text-body-regular text-text-secondary tabular-nums">{formatCount(filtered.length)} payments</p>
                <Pagination page={currentPage} totalPages={totalPages} onChange={setPage} className="w-auto min-w-80 flex-1" />
              </div>
            </>
          )}
        </Panel>

        <div className="col-span-12 grid min-w-0 content-start gap-3 @2xl:grid-cols-2 @3xl:gap-4 @5xl:col-span-3 @5xl:grid-cols-1 @wide:col-start-10 @wide:row-start-2 @ultra:grid-cols-2">
          <Panel title="By status" className="gap-2">
            <ul className="flex flex-col gap-1">
              {STATUSES.map((id) => (
                <li key={id}>
                  <button type="button" aria-pressed={status === id} onClick={() => { setStatus(status === id ? "all" : id); resetSelection(); }} className={cx("flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl p-2 outline-none hover:bg-background-secondary-default focus-visible:ring-2 focus-visible:ring-border-focus-ring", status === id && "bg-background-secondary-default")}>
                    <PaymentStatusChip status={id} />
                    <span className="text-body-medium tabular-nums">{formatCount(counts[id])}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Top assets" description="Settled, in this view" className="gap-3">
            {assets.length ? <RankBars rows={assets.slice(0, 5).map((a) => ({ key: a.key, label: ASSETS[a.key].symbol, value: formatCompactUsd(a.volume), share: a.share, icon: a.key, color: assetColor(a.key) }))} /> : <p className="text-body-regular text-text-secondary">Nothing settled in this view.</p>}
          </Panel>
        </div>
      </Bento>

      {drawerArmed && <PaymentDrawer paymentId={openId} onClose={() => setOpenId(null)} />}
      <RefundDialog payment={refunding ? (refundable[0] ?? null) : null} onClose={() => { setRefunding(false); setSelected(new Set()); }} />
    </>
  );
}
