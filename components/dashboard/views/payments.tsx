"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Selection, SortDescriptor } from "react-aria-components";
import { today, getLocalTimeZone } from "@internationalized/date";
import { RiArrowGoBackLine, RiDownload2Line, RiExchangeDollarLine, RiFileCopyLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Checkbox } from "@/components/base/checkbox/checkbox";
import { DateRangePicker, type DateRangeValue } from "@/components/base/date-picker/date-range-picker";
import { AlertDialog } from "@/components/base/modal/modal";
import { Pagination } from "@/components/base/pagination/pagination";
import { SearchField } from "@/components/base/search-field/search-field";
import { Select, SelectItem } from "@/components/base/select/select";
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@/components/base/table/table";
import { Tag, TagGroup } from "@/components/base/tag-group/tag-group";
import { toast } from "@/components/base/toast/toast";
import { TokenMark } from "@/components/brand/token-mark";
import { NavButton } from "@/components/nav-button";
import { ASSETS, PAY_ASSETS } from "@/lib/assets";
import { formatToken, formatUsd, formatUsdWhole } from "@/lib/format";
import { assetMix, metricsNow, statusCounts, summarize } from "@/lib/metrics";
import { actions, useGateway } from "@/lib/store";
import type { AssetSymbol, Payment, PaymentStatus } from "@/lib/types";
import { cx } from "@/utils/cx";
import { RankBars, assetColor } from "../charts";
import { downloadCsv } from "../csv";
import { formatCompactUsd, formatCount, formatPercent, formatRowDate, formatSeconds } from "../fmt";
import { PaymentDrawer } from "../payment-drawer";
import { Bento, copyText, EmptyState, PageHeader, Panel, PAYMENT_STATUS_LABEL, PaymentStatusChip } from "../ui";

const PAGE_SIZE = 12;
const DAY = 86_400_000;
const STATUSES: PaymentStatus[] = ["settled", "processing", "refunded", "expired"];
const PRESETS = [["all", "Any time"], ["7", "Last 7 days"], ["30", "Last 30 days"], ["90", "Last 90 days"], ["custom", "Custom range"]] as const;
type Preset = (typeof PRESETS)[number][0];
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

/**
 * One layout is mounted at a time, not two toggled with CSS: token icons define SVG gradients by id,
 * and an id that resolves inside a display:none table paints nothing in the visible list.
 */
function useWideMain() {
  const [wide, setWide] = useState(() => (document.getElementById("main")?.clientWidth ?? 0) >= 768);
  useEffect(() => {
    const main = document.getElementById("main");
    if (!main) return;
    const observer = new ResizeObserver(() => setWide(main.clientWidth >= 768));
    observer.observe(main);
    return () => observer.disconnect();
  }, []);
  return wide;
}

export function PaymentsView() {
  const { payments } = useGateway();
  const params = useSearchParams();
  const wide = useWideMain();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<PaymentStatus | "all">("all");
  const [asset, setAsset] = useState<AssetSymbol | "all">("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [sourceId, setSourceId] = useState<string | null>(params.get("source"));
  const [preset, setPreset] = useState<Preset>("all");
  const [custom, setCustom] = useState<DateRangeValue | null>(null);
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [refunding, setRefunding] = useState(false);
  const [sort, setSort] = useState<SortDescriptor>({ column: "date", direction: "descending" });

  const now = metricsNow(payments);
  const dateBounds = useMemo((): [number, number] | null => {
    if (preset === "custom") return custom ? [utc(custom.start), utc(custom.end) + DAY] : null;
    if (preset === "all") return null;
    const days = Number(preset);
    return [now - now % DAY - (days - 1) * DAY, Infinity];
  }, [preset, custom, now]);

  // Everything but status and asset, so each facet can show what picking it would give.
  const scoped = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return payments.filter((p) => {
      const time = new Date(p.createdAt).getTime();
      return (
        (source === "all" || p.sourceType === source) &&
        (sourceId === null || p.sourceId === sourceId) &&
        (dateBounds === null || (time >= dateBounds[0] && time < dateBounds[1])) &&
        (needle === "" || [p.id, p.sourceName, p.payAsset, p.payer].some((field) => field.toLowerCase().includes(needle)))
      );
    });
  }, [payments, query, source, sourceId, dateBounds]);

  const filtered = useMemo(() => scoped.filter((p) => (status === "all" || p.status === status) && (asset === "all" || p.payAsset === asset)), [scoped, status, asset]);
  const sorted = useMemo(() => {
    const compare = SORTERS[String(sort.column)] ?? SORTERS.date;
    const list = [...filtered].sort(compare);
    return sort.direction === "descending" ? list.reverse() : list;
  }, [filtered, sort]);

  const summary = useMemo(() => summarize(filtered), [filtered]);
  const counts = useMemo(() => statusCounts(scoped.filter((p) => asset === "all" || p.payAsset === asset)), [scoped, asset]);
  const assets = useMemo(() => assetMix(filtered), [filtered]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const rows = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const sourceName = sourceId ? payments.find((p) => p.sourceId === sourceId)?.sourceName ?? sourceId : null;
  const chips = [
    status !== "all" && { id: "status", label: `Status: ${PAYMENT_STATUS_LABEL(status)}` },
    asset !== "all" && { id: "asset", label: `Paid with: ${asset}` },
    source !== "all" && { id: "source", label: source === "link" ? "Payment links" : "Widgets" },
    sourceName && { id: "sourceId", label: `Source: ${sourceName}` },
    preset !== "all" && (preset !== "custom" || custom) && { id: "date", label: preset === "custom" ? "Custom dates" : PRESETS.find(([key]) => key === preset)?.[1] ?? "" },
    query.trim() && { id: "query", label: `Search: ${query.trim()}` },
  ].filter((chip): chip is { id: string; label: string } => Boolean(chip));

  const resetSelection = () => { setPage(1); setSelected(new Set()); };
  const removeChip = (id: string) => {
    if (id === "status") setStatus("all");
    if (id === "asset") setAsset("all");
    if (id === "source") setSource("all");
    if (id === "sourceId") setSourceId(null);
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
    toast.success(`Exported ${formatCount(list.length)} payments`);
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
      <Bento>
        {[
          ["Settled volume", formatUsdWhole(summary.volume), `${formatCount(summary.count)} of ${formatCount(summary.total)} payments`],
          ["Success rate", formatPercent(summary.successRate), `${formatCount(summary.inFlightCount)} still in flight`],
          ["Avg settlement", formatSeconds(summary.avgSettle), summary.avgSettle === null ? "Nothing settled" : `95% within ${summary.p95}s`],
          ["Average payment", formatUsd(summary.avgTicket), `${formatCount(summary.payers)} unique payers`],
        ].map(([label, value, note]) => (
          <div key={label} className="col-span-6 flex min-w-0 flex-col gap-0.5 rounded-3xl border border-border-button-default bg-background-inner-default p-4 shadow-card @5xl:col-span-3">
            <p className="truncate text-body-regular text-text-secondary">{label}</p>
            <p className="truncate text-title-2-semibold">{value}</p>
            <p className="truncate text-caption-1-regular text-text-secondary">{note}</p>
          </div>
        ))}

        <Panel className="col-span-12 gap-3 p-3 @3xl:p-3 @5xl:col-span-9">
          <div className="flex flex-wrap items-center gap-2">
            <SearchField aria-label="Search payments" placeholder="Search ID, source, asset or payer" value={query} onChange={(value) => { setQuery(value); resetSelection(); }} className="min-w-[200px] flex-1" />
            <Select aria-label="Filter by date" selectedKey={preset} onSelectionChange={(key) => { setPreset(key as Preset); resetSelection(); }}>
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
                <Button variant="secondary" size="small" leadingIcon={RiArrowGoBackLine} disabled={refundable.length === 0} onClick={() => setRefunding(true)}>Mark refunded</Button>
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
                    <TableColumn>Paid with</TableColumn>
                    <TableColumn id="usd" allowsSorting>{({ sortDirection }) => <SortLabel direction={sortDirection}>Amount</SortLabel>}</TableColumn>
                    <TableColumn id="status" allowsSorting>{({ sortDirection }) => <SortLabel direction={sortDirection}>Status</SortLabel>}</TableColumn>
                    <TableColumn id="date" allowsSorting>{({ sortDirection }) => <SortLabel direction={sortDirection}>Date (UTC)</SortLabel>}</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {rows.map((payment) => (
                      <TableRow key={payment.id} id={payment.id} className="cursor-pointer hover:bg-background-secondary-default">
                        <TableCell><Checkbox slot="selection" size="sm" /></TableCell>
                        <TableCell><span className="block max-w-[220px] truncate text-body-medium text-text-primary" title={payment.sourceName}>{payment.sourceName}</span></TableCell>
                        <TableCell>
                          <span className="flex items-center gap-2 whitespace-nowrap tabular-nums">
                            <TokenMark symbol={payment.payAsset} size="sm" />
                            {formatToken(payment.payAmount, payment.payAsset)}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap tabular-nums">{formatUsd(payment.usd)}</TableCell>
                        <TableCell><PaymentStatusChip status={payment.status} /></TableCell>
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
                        <span className="truncate text-body-medium">{payment.sourceName}</span>
                        <span className="truncate text-caption-1-regular text-text-secondary tabular-nums">{formatToken(payment.payAmount, payment.payAsset)}, {formatRowDate(payment.createdAt)}</span>
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

              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <p className="text-body-regular text-text-secondary tabular-nums">{formatCount(filtered.length)} payments</p>
                <Pagination page={currentPage} totalPages={totalPages} onChange={setPage} />
              </div>
            </>
          )}
        </Panel>

        <div className="col-span-12 grid min-w-0 content-start gap-3 @2xl:grid-cols-2 @3xl:gap-4 @5xl:col-span-3 @5xl:grid-cols-1">
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

      <PaymentDrawer paymentId={openId} onClose={() => setOpenId(null)} />
      <AlertDialog
        isOpen={refunding}
        onOpenChange={setRefunding}
        title={`Mark ${formatCount(refundable.length)} payments as refunded?`}
        description="Only settled payments change. They leave your settled volume. No funds move in this demo."
        confirmLabel="Mark refunded"
        onConfirm={() => {
          actions.refundPayments(refundable.map((p) => p.id));
          setRefunding(false);
          setSelected(new Set());
          toast.success(`${formatCount(refundable.length)} payments marked as refunded`);
        }}
      />
    </>
  );
}
