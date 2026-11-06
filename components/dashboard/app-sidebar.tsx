"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";
import {
  RiBankLine,
  RiDashboardLine,
  RiExchangeDollarLine,
  RiLayoutMasonryLine,
  RiLinksLine,
  RiLogoutBoxRLine,
  RiSettings4Line,
  RiExpandUpDownLine,
} from "@remixicon/react";
import { Avatar } from "@/components/base/avatar/avatar";
import { Dropdown, DropdownDivider, DropdownGroup, DropdownItem, DropdownPopover, DropdownTrigger } from "@/components/base/dropdown/dropdown";
import { Logo } from "@/components/brand/logo";
import { formatUsd, shortAddress } from "@/lib/format";
import { metricsNow } from "@/lib/metrics";
import { failedPayouts, formatPayoutDate, ledger, nextPayoutAt } from "@/lib/payouts";
import { useGateway, useGatewayReady } from "@/lib/store";
import { cx } from "@/utils/cx";
import { guardedPush } from "./unsaved";

const GROUPS = [
  { label: "Money", items: [
    { href: "/dashboard", label: "Overview", icon: RiDashboardLine },
    { href: "/dashboard/payments", label: "Payments", icon: RiExchangeDollarLine },
    { href: "/dashboard/payouts", label: "Payouts", icon: RiBankLine },
  ] },
  { label: "Collect", items: [
    { href: "/dashboard/links", label: "Payment Links", icon: RiLinksLine },
    { href: "/dashboard/widgets", label: "Widgets", icon: RiLayoutMasonryLine },
  ] },
];

function NavItem({ href, label, icon: Icon, pathname, onNavigate, badge }: { href: string; label: string; icon: typeof RiLinksLine; pathname: string; onNavigate?: () => void; badge?: number }) {
  const current = href === "/dashboard" ? pathname === href : pathname.startsWith(href);
  return (
    <Link href={href} onClick={onNavigate} aria-current={current ? "page" : undefined} className="dash-nav-link">
      <Icon aria-hidden />
      {label}
      {badge ? <span aria-label={`${badge} needs attention`} className="ms-auto rounded-full bg-status-rose-background px-1.5 text-caption-1-semibold text-status-rose-text tabular-nums">{badge}</span> : null}
    </Link>
  );
}

export function AppSidebar({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { settings, payments, payouts } = useGateway();
  const ready = useGatewayReady();
  const summary = useMemo(() => {
    const now = metricsNow(payments);
    const next = nextPayoutAt(settings.payouts.schedule, now);
    return { available: ledger(payments, payouts, settings.payouts.holdDays, now).availableUsd, next, failed: failedPayouts(payouts).length };
  }, [payments, payouts, settings.payouts]);

  return (
    <aside className={cx("dash-rail", className)}>
      <div className="flex flex-col gap-3">
        <Link href="/" onClick={onNavigate} aria-label="Gateway home" className="self-start rounded-lg p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring">
          <Logo />
        </Link>
        <Dropdown>
          <DropdownTrigger className="dash-well flex w-full cursor-pointer items-center gap-2 rounded-xl p-1.5 text-start outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring">
            <Avatar initials={ready ? settings.businessName.slice(0, 2).toUpperCase() : ""} size="sm" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body-medium text-text-primary">{ready ? settings.businessName : "\u00a0"}</span>
              <span dir="ltr" className="truncate text-caption-1-regular text-text-secondary">{ready ? shortAddress(settings.walletAddress) : "\u00a0"}</span>
            </span>
            <RiExpandUpDownLine className="size-4 shrink-0 text-foreground-icon-tertiary" aria-hidden />
          </DropdownTrigger>
          <DropdownPopover aria-label="Account" placement="bottom start" className="w-(--trigger-width) p-2">
            <DropdownGroup>
              <DropdownItem onSelect={() => { onNavigate?.(); guardedPush(router, "/dashboard/settings"); }} className="px-2 py-1.5">
                <RiSettings4Line className="size-[18px] text-foreground-icon-secondary" aria-hidden />
                <span className="text-body-medium text-text-primary">Settings</span>
              </DropdownItem>
              <DropdownDivider />
              <DropdownItem onSelect={() => guardedPush(router, "/")} className="px-2 py-1.5">
                <RiLogoutBoxRLine className="size-[18px] text-foreground-icon-secondary" aria-hidden />
                <span className="text-body-medium text-text-primary">Log out</span>
              </DropdownItem>
            </DropdownGroup>
          </DropdownPopover>
        </Dropdown>
      </div>

      <nav aria-label="Dashboard" className="flex flex-col gap-4">
        {GROUPS.map((group) => (
          <div key={group.label} className="flex flex-col gap-1">
            <p className="dash-group-label">{group.label}</p>
            <div className="dash-nav">
              {group.items.map((item) => <NavItem key={item.href} {...item} pathname={pathname} onNavigate={onNavigate} badge={item.href === "/dashboard/payouts" && ready ? summary.failed : undefined} />)}
            </div>
          </div>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-2">
        <Link href="/dashboard/payouts" onClick={onNavigate} className="dash-well flex flex-col gap-0.5 rounded-xl p-2.5 outline-none hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring">
          <span className="text-caption-1-regular text-text-secondary">Available to pay out</span>
          <span className="truncate text-headline-semibold tabular-nums">{ready ? formatUsd(summary.available) : "\u00a0"}</span>
          <span className="truncate text-caption-1-regular text-text-secondary">{summary.next ? `Next payout ${formatPayoutDate(summary.next)}` : "Automatic payouts are off"}</span>
        </Link>
        <div className="dash-nav"><NavItem href="/dashboard/settings" label="Settings" icon={RiSettings4Line} pathname={pathname} onNavigate={onNavigate} /></div>
      </div>
    </aside>
  );
}
