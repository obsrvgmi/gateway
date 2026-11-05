"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  RiAddLine,
  RiDashboardLine,
  RiExchangeDollarLine,
  RiLayoutMasonryLine,
  RiLinksLine,
  RiLogoutBoxRLine,
  RiSettings4Line,
} from "@remixicon/react";
import { ThemeToggle } from "@/components/application/theme/theme-toggle";
import { Avatar } from "@/components/base/avatar/avatar";
import { Dropdown, DropdownDivider, DropdownGroup, DropdownItem, DropdownPopover, DropdownTrigger } from "@/components/base/dropdown/dropdown";
import { Logo } from "@/components/brand/logo";
import { NavButton } from "@/components/nav-button";
import { useGateway, useGatewayReady } from "@/lib/store";
import { cx } from "@/utils/cx";

const NAV = [
  { href: "/dashboard", label: "Overview", icon: RiDashboardLine },
  { href: "/dashboard/links", label: "Payment Links", icon: RiLinksLine },
  { href: "/dashboard/widgets", label: "Widgets", icon: RiLayoutMasonryLine },
  { href: "/dashboard/payments", label: "Payments", icon: RiExchangeDollarLine },
  { href: "/dashboard/settings", label: "Settings", icon: RiSettings4Line },
];

export function AppSidebar({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const { settings } = useGateway();
  const ready = useGatewayReady();

  return (
    <aside className={cx("flex h-full w-[260px] flex-col gap-4 rounded-3xl border border-border-button-white bg-background-primary-default p-3 shadow-sidebar", className)}>
      <Link href="/" onClick={onNavigate} className="rounded-lg p-1 outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring">
        <Logo />
      </Link>

      <NavButton href="/dashboard/links/new" leadingIcon={RiAddLine} onClick={onNavigate} className="w-full">
        New payment link
      </NavButton>

      <nav aria-label="Dashboard" className="flex flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const current = href === "/dashboard" ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={current ? "page" : undefined}
              className={cx(
                "flex items-center gap-2 rounded-2lg p-2 text-body-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-border-focus-ring",
                current ? "bg-linear-to-b from-accent-500 to-accent-600 text-text-on-accent shadow-nav-selected" : "text-text-secondary hover:bg-background-secondary-default",
              )}
            >
              <Icon className={cx("size-5 shrink-0", current ? "text-text-on-accent" : "text-foreground-icon-secondary")} aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-3">
        <ThemeToggle />
        <Dropdown>
          <DropdownTrigger className="flex w-full cursor-pointer items-center gap-2 rounded-2lg p-1.5 text-start outline-none hover:bg-background-secondary-hover data-[focus-visible]:ring-2 data-[focus-visible]:ring-border-focus-ring">
            <Avatar initials={ready ? settings.businessName.slice(0, 2).toUpperCase() : ""} size="sm" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-body-medium text-text-primary">{ready ? settings.businessName : "\u00a0"}</span>
              <span className="truncate text-caption-1-regular text-text-secondary">{ready ? settings.walletAddress : "\u00a0"}</span>
            </span>
          </DropdownTrigger>
          <DropdownPopover aria-label="Account" placement="top start" className="w-[220px] p-2">
            <DropdownGroup>
              <DropdownItem onSelect={() => { onNavigate?.(); router.push("/dashboard/settings"); }} className="px-2 py-1.5">
                <RiSettings4Line className="size-[18px] text-foreground-icon-secondary" aria-hidden />
                <span className="text-body-medium text-text-primary">Settings</span>
              </DropdownItem>
              <DropdownDivider />
              <DropdownItem onSelect={() => router.push("/")} className="px-2 py-1.5">
                <RiLogoutBoxRLine className="size-[18px] text-foreground-icon-secondary" aria-hidden />
                <span className="text-body-medium text-text-primary">Log out</span>
              </DropdownItem>
            </DropdownGroup>
          </DropdownPopover>
        </Dropdown>
      </div>
    </aside>
  );
}
