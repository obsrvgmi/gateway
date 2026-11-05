"use client";

import Link from "next/link";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { RiArrowDownLine, RiArrowUpLine, RiCheckLine, RiFileCopyLine, RiSubtractLine } from "@remixicon/react";
import { Chip, type ChipColor } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { toast } from "@/components/base/toast/toast";
import type { Delta } from "@/lib/metrics";
import type { LinkStatus, PaymentStatus, WidgetStatus } from "@/lib/types";
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
          <h1 className="min-w-0 text-display-4-semibold tracking-[-0.02em] [overflow-wrap:anywhere]">{title}</h1>
          {meta}
        </div>
        {description && <p className="max-w-[72ch] text-body-regular text-text-secondary">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, description, actions, className, children }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cx("flex min-w-0 flex-col gap-4 rounded-3xl border border-border-button-default bg-background-inner-default p-4 shadow-card @3xl:p-5", className)}>
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
      <span className="flex size-12 items-center justify-center rounded-2xl bg-background-secondary-default">
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

export const PAYMENT_STATUS_LABEL = (status: PaymentStatus) => PAYMENT_STATUS[status].label;
export const PaymentStatusChip = ({ status }: { status: PaymentStatus }) => <Chip color={PAYMENT_STATUS[status].color}>{PAYMENT_STATUS[status].label}</Chip>;
export const LinkStatusChip = ({ status }: { status: LinkStatus }) => <Chip color={LINK_STATUS[status].color}>{LINK_STATUS[status].label}</Chip>;
export const WidgetStatusChip = ({ status }: { status: WidgetStatus }) => <Chip color={WIDGET_STATUS[status].color}>{WIDGET_STATUS[status].label}</Chip>;

export async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
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
