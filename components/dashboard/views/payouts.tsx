"use client";

import { useMemo, useState, type ReactNode } from "react";
import { RiAddLine, RiBankLine, RiDeleteBin6Line, RiDownload2Line, RiErrorWarningLine, RiRefreshLine, RiTimeLine, RiWalletLine } from "@remixicon/react";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { Drawer, DrawerBody, DrawerFooter, DrawerHeader } from "@/components/base/drawer/drawer";
import { Input } from "@/components/base/input/input";
import { Label } from "@/components/base/input/label";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/base/modal/modal";
import { Pagination } from "@/components/base/pagination/pagination";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { Select, SelectItem } from "@/components/base/select/select";
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@/components/base/table/table";
import { toast } from "@/components/base/toast/toast";
import { TokenMark } from "@/components/brand/token-mark";
import { NavButton } from "@/components/nav-button";
import { formatToken, formatUsd, shortAddress } from "@/lib/format";
import { metricsNow } from "@/lib/metrics";
import { failedPayouts, formatPayoutDate, HOLD_OPTIONS, ledger, nextPayoutAt, nextPayoutEstimate, WALLET_PATTERN } from "@/lib/payouts";
import { actions, newId, useGateway } from "@/lib/store";
import type { Payout, PayoutSchedule, PayoutStatus } from "@/lib/types";
import { BalanceBar, PayoutBars } from "../charts";
import { payoutsCsv, saveCsv } from "../csv";
import { formatCount, formatDay, formatRowDate, formatStamp, plural } from "../fmt";
import { PayoutDialog } from "../payout-dialog";
import { runPayout } from "../payout-sim";
import { Bento, CopyButton, EmptyState, PageHeader, Panel, PayoutStatusChip, SimulatedTag, useWideMain } from "../ui";

const PAGE_SIZE = 10;
const SCHEDULES: [PayoutSchedule, string][] = [["daily", "Daily"], ["weekly", "Weekly"], ["manual", "Manual"]];

function Legend({ swatch, label, value }: { swatch: ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="flex items-center gap-1.5 text-caption-1-regular text-text-secondary">{swatch}{label}</dt>
      <dd className="truncate text-body-semibold tabular-nums">{value}</dd>
    </div>
  );
}

function retry(payout: Payout, availableInAsset: number) {
  if (availableInAsset + 1e-9 < payout.amount) {
    toast.error("Not enough available", { description: `This payout needs ${formatToken(payout.amount, payout.asset)}.` });
    return false;
  }
  actions.updatePayout(payout.id, { status: "processing", failureReason: undefined });
  runPayout(payout.id);
  toast("Retrying payout", { id: `payout-${payout.id}`, description: "Simulated. No funds move.", duration: Infinity, dismissible: false });
  return true;
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-body-regular text-text-secondary">{label}</dt>
      <dd className="min-w-0 text-end text-body-medium tabular-nums [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function PayoutDrawer({ payoutId, onClose, availableIn }: { payoutId: string | null; onClose: () => void; availableIn: (payout: Payout) => number }) {
  const { payouts } = useGateway();
  const payout = payoutId ? payouts.find((item) => item.id === payoutId) : undefined;
  return (
    <Drawer isOpen={Boolean(payout)} onOpenChange={(open) => !open && onClose()} aria-label="Payout details">
      {payout && (
        <>
          <DrawerHeader title={formatUsd(payout.usd)} description={`${payout.trigger === "scheduled" ? "Scheduled" : "Manual"} payout to ${payout.destinationLabel}`} />
          <DrawerBody>
            <div className="flex flex-col gap-4 pb-4">
              {payout.failureReason && <p className="rounded-xl bg-status-rose-background p-3 text-body-regular text-status-rose-text">{payout.failureReason}</p>}
              <dl className="flex flex-col gap-3">
                <Detail label="Status"><PayoutStatusChip status={payout.status} /></Detail>
                <Detail label="Left your balance">{formatToken(payout.amount, payout.asset)}</Detail>
                <Detail label="Destination receives">{formatToken(payout.receiveAmount, payout.receiveAsset)}</Detail>
                <Detail label="Fees">{formatUsd(payout.feeUsd)}</Detail>
                {payout.paymentCount > 0 && <Detail label="Payments included">{formatCount(payout.paymentCount)}</Detail>}
                <Detail label="Destination"><span dir="ltr" title={payout.destinationAddress}>{shortAddress(payout.destinationAddress)}</span></Detail>
                <Detail label="Requested">{formatStamp(payout.createdAt)}</Detail>
                {payout.completedAt && <Detail label="Completed">{formatStamp(payout.completedAt)}</Detail>}
                <Detail label="Demo reference"><span dir="ltr">{payout.reference}</span></Detail>
              </dl>
              <p className="flex items-center gap-2 text-caption-1-regular text-text-secondary"><SimulatedTag />This record is a mock. It is not a blockchain transaction.</p>
            </div>
          </DrawerBody>
          <DrawerFooter>
            <CopyButton text={payout.reference} label="Reference">Copy reference</CopyButton>
            {payout.status === "failed" && <Button leadingIcon={RiRefreshLine} onClick={() => retry(payout, availableIn(payout))}>Retry payout</Button>}
          </DrawerFooter>
        </>
      )}
    </Drawer>
  );
}

function DestinationModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [invalid, setInvalid] = useState(false);
  const close = () => { setLabel(""); setAddress(""); setInvalid(false); onClose(); };
  const add = () => {
    if (!WALLET_PATTERN.test(address.trim())) {
      setInvalid(true);
      return;
    }
    actions.addDestination({ id: newId("dst_"), label: label.trim() || "Wallet", address: address.trim() });
    toast.success("Destination added");
    close();
  };
  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && close()} size="sm">
      <ModalHeader title="Add a destination" description="A wallet you control. Nothing is verified in this demo." />
      <ModalBody className="flex flex-col gap-3 pb-1">
        <Input label="Label" placeholder="Operations" value={label} onChange={setLabel} autoFocus />
        <Input label="Wallet address" inputDir="ltr" placeholder="name.near or 0x…" value={address} onChange={(value) => { setAddress(value); setInvalid(false); }} isInvalid={invalid} errorMessage="Enter a .near account or a 0x address." />
      </ModalBody>
      <ModalFooter>
        <Button variant="secondary" onClick={close}>Cancel</Button>
        <Button onClick={add}>Add destination</Button>
      </ModalFooter>
    </Modal>
  );
}

export function PayoutsView() {
  const { payments, payouts, settings } = useGateway();
  const wide = useWideMain();
  const [paying, setPaying] = useState(false);
  const [adding, setAdding] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<PayoutStatus | "all">("all");
  const [page, setPage] = useState(1);
  const { holdDays, schedule, destinations, defaultDestinationId, minimumUsd } = settings.payouts;
  const now = metricsNow(payments);
  const position = useMemo(() => ledger(payments, payouts, holdDays, now), [payments, payouts, holdDays, now]);
  const next = nextPayoutAt(schedule, now);
  const failed = failedPayouts(payouts);
  const availableIn = (payout: Payout) => position.available.find((entry) => entry.asset === payout.asset)?.amount ?? 0;
  const destination = destinations.find((item) => item.id === defaultDestinationId);

  const visible = useMemo(() => payouts.filter((payout) => filter === "all" || payout.status === filter), [payouts, filter]);
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const rows = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const recent = useMemo(() => {
    const runs = new Map<string, { key: string; label: string; usd: number; count: number }>();
    for (const payout of payouts) {
      if (payout.status !== "sent") continue;
      const key = payout.createdAt.slice(0, 10);
      const entry = runs.get(key) ?? { key, label: formatDay(payout.createdAt), usd: 0, count: 0 };
      runs.set(key, { ...entry, usd: entry.usd + payout.usd, count: entry.count + 1 });
    }
    return [...runs.values()].slice(0, 16).reverse();
  }, [payouts]);

  const header = (
    <PageHeader
      title="Payouts"
      meta={<SimulatedTag>Simulated, no funds move</SimulatedTag>}
      description="What's yours, what's on the way, and where it goes."
      actions={<>
        <Button variant="secondary" leadingIcon={RiDownload2Line} disabled={payouts.length === 0} onClick={() => { saveCsv(payoutsCsv(visible), "payouts-simulated.csv"); toast.success(`Exported ${formatCount(visible.length)} payouts`, { id: "export", description: "payouts-simulated.csv, marked as simulated." }); }}>Export CSV</Button>
      </>}
    />
  );

  if (payments.length === 0 && payouts.length === 0) {
    return (
      <>
        {header}
        <Panel><EmptyState icon={RiBankLine} title="Nothing to pay out yet" description="Your balance builds here once customers pay. Share a link to take your first payment." action={<NavButton href="/dashboard/links/new">Create payment link</NavButton>} /></Panel>
      </>
    );
  }

  return (
    <>
      {header}

      {failed.slice(0, 2).map((payout) => (
        <div key={payout.id} role="alert" className="dash-plate flex flex-wrap items-center gap-3 rounded-2xl p-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-status-rose-background text-status-rose-text"><RiErrorWarningLine className="size-5" aria-hidden /></span>
          <div className="flex min-w-[200px] flex-1 flex-col">
            <p className="text-body-medium">{formatToken(payout.amount, payout.asset)} to {payout.destinationLabel} failed on {formatRowDate(payout.createdAt)}</p>
            <p className="text-caption-1-regular text-text-secondary">{payout.failureReason}</p>
          </div>
          <Button variant="ghost" size="small" onClick={() => setOpenId(payout.id)}>Details</Button>
          <Button variant="secondary" size="small" leadingIcon={RiRefreshLine} onClick={() => retry(payout, availableIn(payout))}>Retry</Button>
        </div>
      ))}

      <Bento>
        <section aria-label="Balance" className="stage-plate col-span-12 justify-between gap-4 @3xl:p-5 @5xl:col-span-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <h2 className="text-body-regular text-text-secondary">Available to pay out</h2>
              <p className="text-display-3-semibold tracking-[-0.02em] tabular-nums [overflow-wrap:anywhere]">{formatUsd(position.availableUsd)}</p>
              <p className="text-caption-1-regular text-text-secondary">In your settlement account. Gateway never holds it.</p>
            </div>
            <Button leadingIcon={RiBankLine} disabled={position.availableUsd <= 0} onClick={() => setPaying(true)}>Pay out now</Button>
          </div>
          <BalanceBar available={position.availableUsd} held={position.heldUsd} arriving={position.arrivingUsd} />
          <dl className="grid grid-cols-2 gap-3 @2xl:grid-cols-4">
            <Legend swatch={<span aria-hidden className="size-2.5 rounded-xs bg-(--viz-primary)" />} label="Available" value={formatUsd(position.availableUsd)} />
            <Legend swatch={<span aria-hidden className="size-2.5 rounded-xs bg-(--viz-primary) opacity-45" />} label="On hold" value={formatUsd(position.heldUsd)} />
            <Legend swatch={<span aria-hidden className="dash-hatch size-2.5 rounded-xs" />} label="Arriving" value={formatUsd(position.arrivingUsd)} />
            <Legend swatch={<span aria-hidden className="size-2.5 rounded-xs bg-foreground-icon-tertiary" />} label="Paid out to date" value={formatUsd(position.paidOutUsd)} />
          </dl>
          {position.shortfall.map((entry) => (
            <p key={entry.asset} className="flex items-center gap-2 text-caption-1-regular text-text-secondary">
              <RiErrorWarningLine className="size-4 shrink-0 text-foreground-icon-tertiary" aria-hidden />
              Refunds took {entry.asset} {formatToken(-entry.amount, entry.asset)} below zero. New payments cover that first.
            </p>
          ))}
          {position.available.length > 0 && (
            <ul className="grid grid-cols-1 gap-1.5 @2xl:grid-cols-2">
              {position.available.map((entry) => (
                <li key={entry.asset} className="dash-well flex items-center gap-2 rounded-xl px-2.5 py-2">
                  <TokenMark symbol={entry.asset} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-body-medium tabular-nums">{formatToken(entry.amount, entry.asset)}</span>
                  <span className="shrink-0 text-body-regular text-text-secondary tabular-nums">{formatUsd(entry.usd)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <Panel title={next ? `Next payout, ${formatPayoutDate(next)}` : "Automatic payouts are off"} description={next ? `About ${formatUsd(nextPayoutEstimate(position, next))}, including what clears the hold by then` : "Nothing leaves until you pay out."} className="col-span-12 @5xl:col-span-5">
          <div className="grid grid-cols-1 gap-4 @xl:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Schedule</Label>
              <SegmentedControl aria-label="Payout schedule" selectedKeys={[schedule]} onSelectionChange={(keys) => { const value = [...keys][0]; if (value) { actions.updatePayoutSettings({ schedule: value as PayoutSchedule }); toast.success("Schedule updated", { id: "payout-settings" }); } }} className="self-start">
                {SCHEDULES.map(([id, label]) => <SegmentedControlItem key={id} id={id}>{label}</SegmentedControlItem>)}
              </SegmentedControl>
              <p className="text-caption-1-regular text-text-secondary">{schedule === "manual" ? "You choose when." : schedule === "weekly" ? "Mondays at 09:00 UTC." : "Every day at 09:00 UTC."}</p>
            </div>
            <Select label="Refund window" selectedKey={String(holdDays)} onSelectionChange={(key) => { actions.updatePayoutSettings({ holdDays: Number(key) }); toast.success("Refund window updated", { id: "payout-settings" }); }} className="w-full" triggerClassName="w-full">
              {HOLD_OPTIONS.map((days) => <SelectItem key={days} id={String(days)} textValue={days ? plural(days, "day") : "None"}>{days ? plural(days, "day") : "None"}</SelectItem>)}
            </Select>
          </div>
          <div className="dash-well mt-auto flex items-center gap-2.5 rounded-xl p-2.5">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background-primary-default"><RiWalletLine className="size-4.5 text-foreground-icon-secondary" aria-hidden /></span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body-medium">{destination?.label ?? "No destination"}</span>
              <span dir="ltr" className="truncate text-start text-caption-1-regular text-text-secondary">{destination ? shortAddress(destination.address) : "Add one below"}</span>
            </span>
            <span className="shrink-0 text-caption-1-regular text-text-secondary tabular-nums">Min {formatUsd(minimumUsd).replace(".00", "")}</span>
          </div>
        </Panel>

        <Panel id="hold" title="On hold" description={holdDays ? `Your ${holdDays}-day refund window keeps new payments here, so you can refund before funds leave.` : "No refund window: payments are available as soon as they settle."} className="col-span-12 scroll-mt-20 @2xl:col-span-6 @5xl:col-span-4" >
          
          {position.releases.length ? (
            <ul className="flex flex-col divide-y divide-separator-border">
              {position.releases.map((release) => (
                <li key={release.at} className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0">
                  <RiTimeLine className="size-4 shrink-0 text-foreground-icon-tertiary" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-body-regular">Clears {release.label}</span>
                  <span className="shrink-0 text-caption-1-regular text-text-secondary tabular-nums">{plural(release.count, "payment")}</span>
                  <span className="w-20 shrink-0 text-end text-body-medium tabular-nums">{formatUsd(release.usd)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-body-regular text-text-secondary">Nothing is on hold right now.</p>}
        </Panel>

        <Panel title="Where it goes" actions={<Button variant="secondary" size="small" leadingIcon={RiAddLine} onClick={() => setAdding(true)}>Add</Button>} className="col-span-12 @2xl:col-span-6 @5xl:col-span-4">
          <ul className="flex flex-col divide-y divide-separator-border">
            {destinations.map((item) => {
              const isDefault = item.id === defaultDestinationId;
              return (
                <li key={item.id} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-center gap-1.5 text-body-medium"><span className="truncate">{item.label}</span>{isDefault && <Chip color="lime" variant="caption">Default</Chip>}</span>
                    <span dir="ltr" title={item.address} className="truncate text-start text-caption-1-regular text-text-secondary">{shortAddress(item.address)}</span>
                  </span>
                  {!isDefault && <Button variant="ghost" size="small" onClick={() => { actions.setDefaultDestination(item.id); toast.success(`${item.label} is now the default`); }}>Make default</Button>}
                  {!isDefault && <Button variant="ghost" size="small" iconOnly leadingIcon={RiDeleteBin6Line} aria-label={`Remove ${item.label}`} onClick={() => { actions.removeDestination(item.id); toast.success("Destination removed", { actions: [{ label: "Undo", onClick: () => actions.addDestination(item) }] }); }} />}
                </li>
              );
            })}
          </ul>
        </Panel>

        <Panel title="Recent runs" description={recent.length ? `${formatUsd(position.paidOutUsd)} sent across ${plural(position.sentCount, "payout")}` : "Runs appear here after your first payout."} className="col-span-12 @5xl:col-span-4">
          {recent.length > 1 ? <PayoutBars rows={recent} /> : <div className="dash-well h-24 rounded-xl" aria-hidden />}
        </Panel>

        <Panel
          title="History"
          actions={
            <SegmentedControl aria-label="Filter payouts" selectedKeys={[filter]} onSelectionChange={(keys) => { const value = [...keys][0]; if (value) { setFilter(value as PayoutStatus | "all"); setPage(1); } }}>
              <SegmentedControlItem id="all">All</SegmentedControlItem>
              <SegmentedControlItem id="sent">Sent</SegmentedControlItem>
              <SegmentedControlItem id="processing">Sending</SegmentedControlItem>
              <SegmentedControlItem id="failed">{`Failed ${failed.length}`}</SegmentedControlItem>
            </SegmentedControl>
          }
          className="col-span-12 gap-3"
        >
          {rows.length === 0 ? (
            <EmptyState icon={RiBankLine} title={payouts.length ? "No payouts match" : "No payouts yet"} description={payouts.length ? "Try a different status." : "Pay out your available balance to see it here."} />
          ) : wide ? (
            <Table aria-label="Payout history" size="sm" onRowAction={(key) => setOpenId(String(key))}>
              <TableHeader>
                <TableColumn isRowHeader>Date (UTC)</TableColumn>
                <TableColumn>Amount</TableColumn>
                <TableColumn>Destination</TableColumn>
                <TableColumn>Type</TableColumn>
                <TableColumn>Status</TableColumn>
              </TableHeader>
              <TableBody>
                {rows.map((payout) => (
                  <TableRow key={payout.id} id={payout.id} className="cursor-pointer hover:bg-background-secondary-default">
                    <TableCell className="whitespace-nowrap tabular-nums">{formatRowDate(payout.createdAt)}</TableCell>
                    <TableCell><span className="flex items-center gap-2 whitespace-nowrap tabular-nums"><TokenMark symbol={payout.asset} size="sm" />{formatToken(payout.amount, payout.asset)}<span className="text-text-secondary">{formatUsd(payout.usd)}</span></span></TableCell>
                    <TableCell><span className="flex flex-col"><span className="text-body-medium text-text-primary">{payout.destinationLabel}</span><span dir="ltr" className="text-start text-caption-1-regular text-text-secondary">{shortAddress(payout.destinationAddress)}</span></span></TableCell>
                    <TableCell>{payout.trigger === "scheduled" ? "Scheduled" : "Manual"}</TableCell>
                    <TableCell><PayoutStatusChip status={payout.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <ul className="flex flex-col divide-y divide-separator-border" aria-label="Payout history">
              {rows.map((payout) => (
                <li key={payout.id}>
                  <button type="button" onClick={() => setOpenId(payout.id)} className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg py-2 text-start outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring">
                    <TokenMark symbol={payout.asset} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-body-medium tabular-nums">{formatToken(payout.amount, payout.asset)}</span>
                      <span className="truncate text-caption-1-regular text-text-secondary">{formatRowDate(payout.createdAt)}, {payout.destinationLabel}</span>
                    </span>
                    <PayoutStatusChip status={payout.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {rows.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <p className="text-body-regular text-text-secondary tabular-nums">{plural(visible.length, "payout")}</p>
              <Pagination page={currentPage} totalPages={totalPages} onChange={setPage} />
            </div>
          )}
        </Panel>
      </Bento>

      <PayoutDialog isOpen={paying} onOpenChange={setPaying} />
      <DestinationModal isOpen={adding} onClose={() => setAdding(false)} />
      <PayoutDrawer payoutId={openId} onClose={() => setOpenId(null)} availableIn={availableIn} />
    </>
  );
}
