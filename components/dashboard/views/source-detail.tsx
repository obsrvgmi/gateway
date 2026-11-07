"use client";

import dynamic from "next/dynamic";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { RiEditLine, RiExternalLinkLine, RiPauseLine, RiPlayLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { toast } from "@/components/base/toast/toast";
import { TokenMark } from "@/components/brand/token-mark";
import { NavButton } from "@/components/nav-button";
import { embedSnippet } from "@/lib/embed";
import { formatDate, formatToken, formatUsd } from "@/lib/format";
import { sourceTotals, sourceTrend } from "@/lib/metrics";
import { actions, useGateway } from "@/lib/store";
import { useOrigin } from "@/lib/use-origin";
import { Sparkline } from "../charts";
import { formatCount, relativeTime } from "../fmt";
import { preloadPaymentDrawer } from "../preload";
import { CopyButton, EmptyState, LinkStatusChip, PageHeader, Panel, PaymentStatusChip, WidgetStatusChip } from "../ui";

const PaymentDrawer = dynamic(() => preloadPaymentDrawer().then((module) => module.PaymentDrawer), { ssr: false });

/** One link or widget: what it's for, how it's doing, and every payment it has taken. */
export function SourceDetailView({ kind }: { kind: "link" | "widget" }) {
  const { id } = useParams<{ id: string }>();
  const { links, widgets, payments } = useGateway();
  const origin = useOrigin();
  const [openId, setOpenId] = useState<string | null>(null);
  const link = kind === "link" ? links.find((item) => item.id === id) : undefined;
  const widget = kind === "widget" ? widgets.find((item) => item.id === id) : undefined;
  const totals = useMemo(() => sourceTotals(payments, id), [payments, id]);
  const trend = useMemo(() => sourceTrend(payments, id), [payments, id]);
  const own = useMemo(() => payments.filter((payment) => payment.sourceId === id), [payments, id]);
  const [now] = useState(Date.now);

  if (!link && !widget) {
    return (
      <>
        <PageHeader title="Not found" />
        <Panel><EmptyState icon={RiExternalLinkLine} title="This doesn't exist any more" description="It may have been deleted." action={<NavButton href={kind === "link" ? "/dashboard/links" : "/dashboard/widgets"}>Back to the list</NavButton>} /></Panel>
      </>
    );
  }

  const paused = link ? link.status === "paused" : widget?.status === "paused";
  const toggle = () => {
    if (link) actions.updateLink(link.id, { status: paused ? "active" : "paused" });
    if (widget) actions.updateWidget(widget.id, { status: paused ? "live" : "paused" });
    toast.success(paused ? "Resumed" : "Paused", { id: `source-${id}` });
  };
  const url = `${origin}/pay/${id}`;
  const snippet = embedSnippet(origin, id, "html");

  return (
    <>
      <PageHeader
        title={link?.title ?? widget?.name}
        meta={link ? <LinkStatusChip status={link.status} /> : widget ? <WidgetStatusChip status={widget.status} /> : null}
        description={link?.description || (widget?.site ? `On ${widget.site}` : undefined)}
        actions={<>
          {!(link?.status === "expired") && <Button variant="secondary" leadingIcon={paused ? RiPlayLine : RiPauseLine} onClick={toggle}>{paused ? "Resume" : "Pause"}</Button>}
          <NavButton href={`/dashboard/${kind === "link" ? "links" : "widgets"}/${id}/edit`} variant="secondary" leadingIcon={RiEditLine}>Edit</NavButton>
          {link && <NavButton href={`/pay/${id}`} leadingIcon={RiExternalLinkLine}>Open checkout</NavButton>}
        </>}
      />
      <div className="grid grid-cols-12 gap-3 @3xl:gap-4">
        <Panel title="Performance" description="Settled, all time" className="col-span-12 @3xl:col-span-5">
          <p className="text-display-3-semibold tracking-[-0.02em] tabular-nums">{formatUsd(totals.volume)}</p>
          <p className="text-body-regular text-text-secondary">{formatCount(totals.count)} payments</p>
          <Sparkline values={trend} label="Settled volume per day, last 30 days" className="h-12 w-full" />
        </Panel>
        <Panel title={link ? "Share" : "Embed"} className="col-span-12 @3xl:col-span-7">
          <div dir="ltr" className="dash-well overflow-x-auto rounded-xl px-3 py-2 text-caption-1-regular"><code>{link ? url : snippet}</code></div>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={link ? url : snippet} label={link ? "Link" : "Embed code"} variant="primary" />
          </div>
          <dl className="grid grid-cols-2 gap-3">
            <div><dt className="text-caption-1-regular text-text-secondary">Amount</dt><dd className="text-body-medium tabular-nums">{(link?.amount ?? widget?.amount) != null ? formatUsd((link?.amount ?? widget?.amount) as number) : "Customer sets it"}</dd></div>
            <div><dt className="text-caption-1-regular text-text-secondary">You receive</dt><dd className="text-body-medium">{link?.receiveAsset ?? widget?.receiveAsset}</dd></div>
            <div><dt className="text-caption-1-regular text-text-secondary">Created</dt><dd className="text-body-medium">{formatDate((link?.createdAt ?? widget?.createdAt) as string)}</dd></div>
            {link?.expiresAt && <div><dt className="text-caption-1-regular text-text-secondary">Expires</dt><dd className="text-body-medium">{formatDate(link.expiresAt)}</dd></div>}
          </dl>
        </Panel>
        <Panel title="Payments" className="col-span-12 gap-2">
          {own.length === 0 ? <EmptyState icon={RiExternalLinkLine} title="No payments yet" description={link ? "Share the link to take your first payment." : "Embed the widget to take your first payment."} /> : (
            <ul className="flex flex-col divide-y divide-separator-border">
              {own.slice(0, 100).map((payment) => (
                <li key={payment.id}>
                  <button type="button" onClick={() => setOpenId(payment.id)} className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg py-2 text-start outline-none hover:bg-background-secondary-default focus-visible:ring-2 focus-visible:ring-border-focus-ring">
                    <TokenMark symbol={payment.payAsset} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-body-medium tabular-nums">{formatToken(payment.payAmount, payment.payAsset)}</span>
                      <span className="truncate text-caption-1-regular text-text-secondary">{relativeTime(payment.createdAt, now)}</span>
                    </span>
                    <span className="text-body-medium tabular-nums">{formatUsd(payment.usd)}</span>
                    <PaymentStatusChip status={payment.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      {openId && <PaymentDrawer paymentId={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}
