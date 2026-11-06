"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { RiAddLine, RiDeleteBin6Line, RiExchangeDollarLine, RiExternalLinkLine, RiFileCopy2Line, RiFileCopyLine, RiLayoutGridLine, RiLinksLine, RiListCheck, RiMore2Fill, RiPauseLine, RiPencilLine, RiPlayLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Dropdown, DropdownDivider, DropdownGroup, DropdownItem, DropdownPopover, DropdownTrigger } from "@/components/base/dropdown/dropdown";
import { SearchField } from "@/components/base/search-field/search-field";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@/components/base/table/table";
import { toast } from "@/components/base/toast/toast";
import { TokenMark } from "@/components/brand/token-mark";
import { NavButton } from "@/components/nav-button";
import { formatDate, formatUsd, formatUsdWhole } from "@/lib/format";
import { sourceTotals, sourceTrend } from "@/lib/metrics";
import { actions, newId, useGateway } from "@/lib/store";
import type { LinkStatus, PaymentLink } from "@/lib/types";
import { Sparkline } from "../charts";
import { formatCount, plural } from "../fmt";
import { AddTile, Bento, copyText, EmptyState, LinkStatusChip, PageHeader, Panel, Stat } from "../ui";

type Tab = LinkStatus | "all";
const TABS: [Tab, string][] = [["all", "All"], ["active", "Active"], ["paused", "Paused"], ["expired", "Expired"]];

export function LinksView() {
  const { links, payments } = useGateway();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [view, setView] = useState<"cards" | "table">("cards");

  const rows = useMemo(
    () => links.map((link) => ({ link, totals: sourceTotals(payments, link.id), trend: sourceTrend(payments, link.id) })).sort((a, b) => b.totals.volume - a.totals.volume),
    [links, payments],
  );
  const needle = query.trim().toLowerCase();
  const visible = rows.filter(({ link }) => (tab === "all" || link.status === tab) && (needle === "" || link.title.toLowerCase().includes(needle) || link.id.includes(needle)));
  const volume = rows.reduce((sum, row) => sum + row.totals.volume, 0);
  const count = rows.reduce((sum, row) => sum + row.totals.count, 0);
  const add = <NavButton href="/dashboard/links/new" leadingIcon={RiAddLine}>New payment link</NavButton>;

  if (links.length === 0) {
    return (
      <>
        <PageHeader title="Payment Links" description="Hosted checkouts you can share anywhere." actions={add} />
        <Panel><EmptyState icon={RiLinksLine} title="No payment links yet" description="Create a link, send it to a customer, and watch the payment land in your wallet." action={<NavButton href="/dashboard/links/new" leadingIcon={RiAddLine}>Create payment link</NavButton>} /></Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Payment Links" description="Hosted checkouts you can share anywhere." actions={add} />
      <Bento>
        {[
          ["Active links", formatCount(links.filter((l) => l.status === "active").length), `of ${formatCount(links.length)} in total`],
          ["Settled volume", formatUsdWhole(volume), "All time, across links"],
          ["Settled payments", formatCount(count), "All time, across links"],
          ["Top link", rows[0].totals.volume ? rows[0].link.title : "None yet", rows[0].totals.volume ? formatUsdWhole(rows[0].totals.volume) : "No settled payments"],
        ].map(([label, value, note]) => (
          <Stat key={label} label={label} value={<span title={value}>{value}</span>} note={note} />
        ))}
      </Bento>

      <div className="flex flex-wrap items-center gap-2">
        <SearchField aria-label="Search links" placeholder="Search links" value={query} onChange={setQuery} className="min-w-[200px] flex-1" />
        <SegmentedControl aria-label="Filter by status" selectedKeys={[tab]} onSelectionChange={(keys) => { const next = [...keys][0]; if (next) setTab(next as Tab); }}>
          {TABS.map(([id, label]) => <SegmentedControlItem key={id} id={id}>{`${label} ${id === "all" ? links.length : links.filter((l) => l.status === id).length}`}</SegmentedControlItem>)}
        </SegmentedControl>
        <SegmentedControl aria-label="Layout" selectedKeys={[view]} onSelectionChange={(keys) => { const next = [...keys][0]; if (next) setView(next as "cards" | "table"); }}>
          <SegmentedControlItem id="cards" aria-label="Cards"><RiLayoutGridLine className="size-4" aria-hidden /></SegmentedControlItem>
          <SegmentedControlItem id="table" aria-label="Table"><RiListCheck className="size-4" aria-hidden /></SegmentedControlItem>
        </SegmentedControl>
      </div>

      {visible.length === 0 ? (
        <Panel><EmptyState icon={RiLinksLine} title="No links match" description="Try a different search or status." action={<Button variant="secondary" onClick={() => { setQuery(""); setTab("all"); }}>Clear filters</Button>} /></Panel>
      ) : view === "cards" ? (
        <Bento>
          {visible.map(({ link, totals, trend }) => (
            <Panel key={link.id} className="col-span-12 gap-3 @xl:col-span-6 @5xl:col-span-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <TokenMark symbol={link.receiveAsset} />
                  <div className="flex min-w-0 flex-col">
                    <h2 className="truncate text-body-semibold" title={link.title}><Link href={`/dashboard/links/${link.id}`} className="rounded outline-none hover:underline focus-visible:ring-2 focus-visible:ring-border-focus-ring">{link.title}</Link></h2>
                    <p className="truncate text-caption-1-regular text-text-secondary">{link.amount === null ? "Customer sets amount" : formatUsd(link.amount)}, to {link.receiveAsset}</p>
                  </div>
                </div>
                <LinkMenu link={link} />
              </div>
              <div className="dash-well flex items-end justify-between gap-3 rounded-2xl p-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-headline-semibold">{formatUsdWhole(totals.volume)}</span>
                  <span className="text-caption-1-regular text-text-secondary tabular-nums">{plural(totals.count, "payment")}</span>
                </div>
                <Sparkline values={trend} label={`${link.title}, volume over 30 days`} className="w-24 shrink-0" />
              </div>
              <div className="flex items-center justify-between gap-2">
                <LinkStatusChip status={link.status} />
                <span className="truncate text-caption-1-regular text-text-secondary">{link.expiresAt ? `Expires ${formatDate(link.expiresAt)}` : `Created ${formatDate(link.createdAt)}`}</span>
              </div>
            </Panel>
          ))}
          <AddTile count={visible.length} href="/dashboard/links/new" label="Create another link" icon={RiAddLine} />
        </Bento>
      ) : (
        <Panel className="p-2 @3xl:p-2">
          <Table aria-label="Payment links" className="min-w-[680px]">
            <TableHeader>
              <TableColumn isRowHeader>Link</TableColumn>
              <TableColumn>Status</TableColumn>
              <TableColumn>Amount</TableColumn>
              <TableColumn>Payments</TableColumn>
              <TableColumn>Volume</TableColumn>
              <TableColumn aria-label="Actions" />
            </TableHeader>
            <TableBody>
              {visible.map(({ link, totals }) => (
                <TableRow key={link.id} id={link.id}>
                  <TableCell>
                    <span className="flex max-w-[280px] flex-col">
                      <Link href={`/dashboard/links/${link.id}`} className="truncate rounded text-body-medium text-text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-border-focus-ring" title={link.title}>{link.title}</Link>
                      <span className="text-caption-1-regular text-text-secondary">Created {formatDate(link.createdAt)}</span>
                    </span>
                  </TableCell>
                  <TableCell><LinkStatusChip status={link.status} /></TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{link.amount === null ? "Customer sets" : `${formatUsd(link.amount)} to ${link.receiveAsset}`}</TableCell>
                  <TableCell className="tabular-nums">{formatCount(totals.count)}</TableCell>
                  <TableCell className="tabular-nums">{formatUsd(totals.volume)}</TableCell>
                  <TableCell><LinkMenu link={link} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>
      )}
    </>
  );
}

function LinkMenu({ link }: { link: PaymentLink }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  return (
    <Dropdown isOpen={open} onOpenChange={setOpen}>
      <DropdownTrigger aria-label={`Actions for ${link.title}`} className="button-key inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-2lg border bg-background-primary-default text-foreground-icon-primary outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring">
        <RiMore2Fill className="size-[18px]" aria-hidden />
      </DropdownTrigger>
      <DropdownPopover aria-label={`Actions for ${link.title}`} placement="bottom end" className="w-[200px] p-2">
        <DropdownGroup>
          <MenuRow icon={RiPencilLine} label="Edit" onSelect={run(() => router.push(`/dashboard/links/${link.id}/edit`))} />
          <MenuRow icon={RiFileCopyLine} label="Copy link" onSelect={run(() => copyText(`${window.location.origin}/pay/${link.id}`, "Link"))} />
          <MenuRow
            icon={RiFileCopy2Line}
            label="Duplicate"
            onSelect={run(() => {
              actions.addLink({ ...link, id: newId("lnk_"), title: `${link.title} copy`, status: "paused", createdAt: new Date().toISOString() });
              toast.success("Link duplicated", { description: "The copy starts paused." });
            })}
          />
          <MenuRow icon={RiExternalLinkLine} label="Open checkout" onSelect={run(() => router.push(`/pay/${link.id}`))} />
          <MenuRow icon={RiExchangeDollarLine} label="View payments" onSelect={run(() => router.push(`/dashboard/payments?source=${link.id}`))} />
          {link.status !== "expired" && (
            <MenuRow
              icon={link.status === "active" ? RiPauseLine : RiPlayLine}
              label={link.status === "active" ? "Pause" : "Resume"}
              onSelect={run(() => {
                const { status } = link;
                actions.updateLink(link.id, { status: status === "active" ? "paused" : "active" });
                toast.success(status === "active" ? "Link paused" : "Link resumed", { id: `link-${link.id}`, description: status === "active" ? "It won't take payments until you resume it." : "It's taking payments again.", actions: [{ label: "Undo", onClick: () => actions.updateLink(link.id, { status }) }] });
              })}
            />
          )}
          <DropdownDivider />
          <MenuRow
            icon={RiDeleteBin6Line}
            label="Delete"
            onSelect={run(() => {
              actions.removeLink(link.id);
              toast.success("Link deleted", { description: "Past payments stay in your history.", actions: [{ label: "Undo", onClick: () => actions.addLink(link) }] });
            })}
          />
        </DropdownGroup>
      </DropdownPopover>
    </Dropdown>
  );
}

function MenuRow({ icon: Icon, label, onSelect }: { icon: typeof RiFileCopyLine; label: string; onSelect: () => void }) {
  return (
    <DropdownItem onSelect={onSelect} className="px-2 py-1.5">
      <Icon className="size-[18px] shrink-0 text-foreground-icon-secondary" aria-hidden />
      <span className="text-body-medium text-text-primary">{label}</span>
    </DropdownItem>
  );
}

