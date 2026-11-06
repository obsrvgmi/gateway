"use client";

import { useGateway } from "@/lib/store";
import Link from "next/link";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { RiArrowDownLine, RiArrowRightSLine, RiArrowUpLine, RiCheckLine, RiFileCopyLine, RiSubtractLine } from "@remixicon/react";
import { Chip, type ChipColor } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { toast } from "@/components/base/toast/toast";
import type { Delta } from "@/lib/metrics";
import type { LinkStatus, PaymentStatus, PayoutStatus, WidgetStatus } from "@/lib/types";
import { cx } from "@/utils/cx";

/** The page grid. Spans use container queries, so a view is laid out by the room it has, not the window. */
export function Bento({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx("grid grid-cols-12 gap-3 @3xl:gap-4", className)}>{children}</div>;
}

export function PageHeader({ title, description, meta, actions }: { title: ReactNode; description?: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 max-w-full flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="min-w-0 text-title-1-semibold tracking-[-0.02em] [overflow-wrap:anywhere]">{title}</h1>
          {meta}
        </div>
        {description && <p className="max-w-[72ch] text-body-regular text-text-secondary">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ id, title, description, actions, className, children }: { id?: string; title?: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={cx("dash-plate flex min-w-0 flex-col gap-4 rounded-3xl p-4 @3xl:p-5", className)}>
      {title && (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-headline-semibold">{title}</h2>
            {description && <p className="text-body-regular text-text-secondary">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** A plain "open the filtered view" link for a panel's header. */
export function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex shrink-0 items-center gap-0.5 rounded text-body-medium text-text-secondary outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring">
      {children}
      <RiArrowRightSLine className="size-4 rtl:rotate-180" aria-hidden />
    </Link>
  );
}

/** One figure. With `href` the whole tile opens the view behind the number. */
export function Stat({ label, value, note, href, className, children }: { label: string; value: ReactNode; note?: ReactNode; href?: string; className?: string; children?: ReactNode }) {
  const body = (
    <>
      <p className="truncate text-body-regular text-text-secondary">{label}</p>
      <p className="truncate text-title-2-semibold tabular-nums">{value}</p>
      {note && <p className="truncate text-caption-1-regular text-text-secondary">{note}</p>}
      {children}
    </>
  );
  const shared = cx("dash-plate col-span-6 flex min-w-0 flex-col gap-1 rounded-3xl p-4 @5xl:col-span-3", className);
  return href ? <Link href={href} className={cx(shared, "outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring")}>{body}</Link> : <div className={shared}>{body}</div>;
}

/** Said wherever something could be mistaken for a real transfer. */
export function SimulatedTag({ className, children = "Simulated" }: { className?: string; children?: ReactNode }) {
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1.5 rounded-md border border-dashed border-border-button-hover px-1.5 py-0.5 text-caption-1-medium text-text-secondary", className)}>
      <span aria-hidden className="size-1.5 rounded-full bg-status-orange-text" />
      {children}
    </span>
  );
}

/** Shown wherever money appears while the workspace runs in test mode. Nothing in live mode. */
export function ModeTag({ className, children = "Test mode" }: { className?: string; children?: ReactNode }) {
  const { mode } = useGateway();
  return mode === "live" ? null : <SimulatedTag className={className}>{children}</SimulatedTag>;
}

/**
 * One layout is mounted at a time, not two toggled with CSS: token icons define SVG gradients by id,
 * and an id that resolves inside a display:none table paints nothing in the visible list.
 */
export function useWideMain() {
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

/** Up is only good when the metric says so: faster settlement is a falling number. */
export function DeltaChip({ delta, upIsGood = true }: { delta: Delta; upIsGood?: boolean }) {
  const moved = delta.direction === "up" || delta.direction === "down";
  const good = delta.direction === "up" ? upIsGood : !upIsGood;
  const color: ChipColor = !moved ? "neutral" : good ? "lime" : "rose";
  const Icon = delta.direction === "up" ? RiArrowUpLine : delta.direction === "down" ? RiArrowDownLine : RiSubtractLine;
  return (
    <Chip color={color} className="gap-0.5 tabular-nums">
      {delta.direction !== "none" && <Icon className="size-3.5" aria-hidden />}
      {delta.label}
    </Chip>
  );
}

const TILE_WIDE = ["@5xl:col-span-12", "@5xl:col-span-8", "@5xl:col-span-4"];

/** Fills whatever a card grid leaves empty on its last row, at two and three columns. */
export function AddTile({ count, href, label, icon: Icon }: { count: number; href: string; label: string; icon: ComponentType<{ className?: string }> }) {
  return (
    <Link href={href} className={cx("col-span-12 flex min-h-24 items-center justify-center gap-2 rounded-3xl border border-dashed border-border-button-hover text-body-medium text-text-secondary outline-none transition-colors duration-150 hover:bg-background-inner-default hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring", count % 2 ? "@xl:col-span-6" : "@xl:col-span-12", TILE_WIDE[count % 3])}>
      <Icon className="size-5" />
      {label}
    </Link>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: ComponentType<{ className?: string }>; title: string; description: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <span className="dash-well flex size-12 items-center justify-center rounded-2xl">
        <Icon className="size-6 text-foreground-icon-secondary" />
      </span>
      <div className="flex flex-col gap-1">
        <h3 className="text-headline-semibold">{title}</h3>
        <p className="max-w-[44ch] text-body-regular text-text-secondary">{description}</p>
      </div>
      {action}
    </div>
  );
}

export function NoData({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("flex min-h-24 flex-1 items-center justify-center rounded-2xl bg-background-secondary-default p-4 text-center text-body-regular text-text-secondary", className)}>{children}</p>;
}

const PAYMENT_STATUS: Record<PaymentStatus, { label: string; color: ChipColor }> = {
  settled: { label: "Settled", color: "lime" },
  processing: { label: "Processing", color: "yellow" },
  refunded: { label: "Refunded", color: "cyan" },
  expired: { label: "Expired", color: "neutral" },
  failed: { label: "Failed", color: "rose" },
};
const LINK_STATUS: Record<LinkStatus, { label: string; color: ChipColor }> = {
  active: { label: "Active", color: "lime" },
  paused: { label: "Paused", color: "yellow" },
  expired: { label: "Expired", color: "neutral" },
};
const WIDGET_STATUS: Record<WidgetStatus, { label: string; color: ChipColor }> = {
  live: { label: "Live", color: "lime" },
  paused: { label: "Paused", color: "yellow" },
};

const PAYOUT_STATUS: Record<PayoutStatus, { label: string; color: ChipColor }> = {
  sent: { label: "Sent", color: "lime" },
  awaiting_signature: { label: "Needs signature", color: "yellow" },
  processing: { label: "Sending", color: "yellow" },
  failed: { label: "Failed", color: "rose" },
  expired: { label: "Expired", color: "neutral" },
};

export const PayoutStatusChip = ({ status }: { status: PayoutStatus }) => <Chip color={PAYOUT_STATUS[status].color}>{PAYOUT_STATUS[status].label}</Chip>;
export const PAYMENT_STATUS_LABEL = (status: PaymentStatus) => PAYMENT_STATUS[status].label;
export const PaymentStatusChip = ({ status }: { status: PaymentStatus }) => <Chip color={PAYMENT_STATUS[status].color}>{PAYMENT_STATUS[status].label}</Chip>;
export const LinkStatusChip = ({ status }: { status: LinkStatus }) => <Chip color={LINK_STATUS[status].color}>{LINK_STATUS[status].label}</Chip>;
export const WidgetStatusChip = ({ status }: { status: WidgetStatus }) => <Chip color={WIDGET_STATUS[status].color}>{WIDGET_STATUS[status].label}</Chip>;


export async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`, { id: "copied" });
    return true;
  } catch {
    toast.error("Couldn't copy", { description: "Your browser blocked clipboard access. Select the text and copy it manually." });
    return false;
  }
}

export function CopyButton({ text, label, children, variant = "secondary", size, disabled }: { text: string; label: string; children?: ReactNode; variant?: "primary" | "secondary"; size?: "small"; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <Button variant={variant} size={size} disabled={disabled} leadingIcon={copied ? RiCheckLine : RiFileCopyLine} onClick={async () => setCopied(await copyText(text, label))}>
      {children ?? "Copy"}
    </Button>
  );
}
