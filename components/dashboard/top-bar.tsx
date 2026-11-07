"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { RiAddLine, RiArrowDownSLine, RiLayoutMasonryLine, RiLinksLine, RiMenuLine, RiSearchLine } from "@remixicon/react";
import { ThemeToggle } from "@/components/application/theme/theme-toggle";
import { Button } from "@/components/base/buttons/button";
import { Dropdown, DropdownGroup, DropdownItem, DropdownPopover, DropdownTrigger } from "@/components/base/dropdown/dropdown";
import { Kbd } from "@/components/base/kbd/kbd";
import { preloadCommandPalette } from "./preload";
import { NotificationBell } from "./notification-bell";
import { ModeTag } from "./ui";
import { guardedPush } from "./unsaved";

const CommandPalette = dynamic(() => preloadCommandPalette().then((module) => module.CommandPalette), { ssr: false });

const TITLES: Record<string, string> = { dashboard: "Overview", payments: "Payments", payouts: "Payouts", links: "Payment Links", widgets: "Widgets", settings: "Settings", notifications: "Notifications", statements: "Statements", new: "New", edit: "Edit" };

/** Path segments that name a screen. An id between them is skipped. */
function crumbs(pathname: string) {
  const parts = pathname.split("/").filter(Boolean);
  const trail: { href: string; label: string }[] = [];
  parts.forEach((part, index) => {
    const label = TITLES[part];
    if (!label || (part === "dashboard" && parts.length > 1)) return;
    trail.push({ href: `/${parts.slice(0, index + 1).join("/")}`, label });
  });
  return trail;
}

export function TopBar({ onOpenNavigation, railToggle }: { onOpenNavigation: () => void; railToggle?: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [searching, setSearching] = useState(false);
  const [armed, setArmed] = useState(false);
  if (searching && !armed) setArmed(true);
  const trail = crumbs(pathname);

  // Mounted closed once the page has settled, so ⌘K opens it in the same frame and no keystroke is lost.
  useEffect(() => {
    const timer = window.setTimeout(() => setArmed(true), 1500);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearching((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="dash-bar">
      <Button variant="ghost" iconOnly leadingIcon={RiMenuLine} aria-label="Open navigation" onClick={onOpenNavigation} className="-ms-1 lg:hidden" />
      {railToggle}
      <nav aria-label="Breadcrumb" className="flex min-w-0 flex-1 items-center gap-1.5 text-body-medium">
        {trail.map((crumb, index) => (
          <Fragment key={crumb.href}>
            {index > 0 && <span aria-hidden className="text-text-tertiary">/</span>}
            {index === trail.length - 1 ? (
              <span aria-current="page" className="truncate text-text-primary">{crumb.label}</span>
            ) : (
              <Link href={crumb.href} className="truncate rounded text-text-secondary outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring">{crumb.label}</Link>
            )}
          </Fragment>
        ))}
      </nav>
      <ModeTag className="hidden sm:inline-flex" />
      <NotificationBell />
      <button type="button" onClick={() => setSearching(true)} aria-label="Search and jump to" className="dash-search">
        <RiSearchLine className="size-4" aria-hidden />
        <span className="hidden w-32 text-start md:inline">Search</span>
        <Kbd className="hidden md:inline-flex">⌘K</Kbd>
      </button>
      <ThemeToggle appearance="segmented" size="small" className="hidden sm:flex" />
      <Dropdown>
        <DropdownTrigger aria-label="Create" className="button-depth bg-button-primary inline-flex h-9 cursor-pointer items-center gap-0.5 overflow-hidden rounded-2lg px-2 text-body-medium text-text-on-accent outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-offset-2 data-[focus-visible]:ring-offset-background-full data-[focus-visible]:ring-border-focus-ring">
          <RiAddLine className="size-5" aria-hidden />
          <span className="hidden px-0.5 sm:inline">New</span>
          <RiArrowDownSLine className="hidden size-4 sm:block" aria-hidden />
        </DropdownTrigger>
        <DropdownPopover aria-label="Create" placement="bottom end" className="w-[200px] p-2">
          <DropdownGroup>
            <DropdownItem onSelect={() => guardedPush(router, "/dashboard/links/new")} className="px-2 py-1.5">
              <RiLinksLine className="size-[18px] text-foreground-icon-secondary" aria-hidden />
              <span className="text-body-medium text-text-primary">Payment link</span>
            </DropdownItem>
            <DropdownItem onSelect={() => guardedPush(router, "/dashboard/widgets/new")} className="px-2 py-1.5">
              <RiLayoutMasonryLine className="size-[18px] text-foreground-icon-secondary" aria-hidden />
              <span className="text-body-medium text-text-primary">Checkout widget</span>
            </DropdownItem>
          </DropdownGroup>
        </DropdownPopover>
      </Dropdown>
      {armed && <CommandPalette isOpen={searching} onOpenChange={setSearching} />}
    </header>
  );
}
