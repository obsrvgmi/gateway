"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import { RiAddLine, RiArrowRightUpLine, RiBankLine, RiDashboardLine, RiExchangeDollarLine, RiLayoutMasonryLine, RiLinksLine, RiSearchLine, RiSettings4Line } from "@remixicon/react";
import { Modal } from "@/components/base/modal/modal";
import { formatUsd } from "@/lib/format";
import { useGateway } from "@/lib/store";
import { cx } from "@/utils/cx";
import { guardedPush } from "./unsaved";

interface Entry {
  id: string;
  group: string;
  label: string;
  hint?: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
}

const PAGES: Entry[] = [
  { id: "overview", group: "Go to", label: "Overview", href: "/dashboard", icon: RiDashboardLine },
  { id: "payments", group: "Go to", label: "Payments", href: "/dashboard/payments", icon: RiExchangeDollarLine },
  { id: "payouts", group: "Go to", label: "Payouts", href: "/dashboard/payouts", icon: RiBankLine },
  { id: "links", group: "Go to", label: "Payment Links", href: "/dashboard/links", icon: RiLinksLine },
  { id: "widgets", group: "Go to", label: "Widgets", href: "/dashboard/widgets", icon: RiLayoutMasonryLine },
  { id: "settings", group: "Go to", label: "Settings", href: "/dashboard/settings", icon: RiSettings4Line },
  { id: "new-link", group: "Create", label: "New payment link", href: "/dashboard/links/new", icon: RiAddLine },
  { id: "new-widget", group: "Create", label: "New checkout widget", href: "/dashboard/widgets/new", icon: RiAddLine },
];

const RESULT_LIMIT = 9;

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { links, widgets, payments } = useGateway();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const input = useRef<HTMLInputElement>(null);

  // A modal closed just before this opened gives focus back to its trigger when its exit ends, which
  // would leave typing and Enter on the page behind. The input is the palette's only tab stop.
  useEffect(() => {
    const field = input.current;
    if (!field) return;
    const recover = () => requestAnimationFrame(() => { if (field.isConnected && document.activeElement !== field) field.focus(); });
    field.addEventListener("blur", recover);
    return () => field.removeEventListener("blur", recover);
  }, []);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return PAGES;
    const matches = (text: string) => text.toLowerCase().includes(needle);
    const found: Entry[] = [
      ...PAGES.filter((page) => matches(page.label)),
      ...links.filter((link) => matches(link.title) || matches(link.id)).slice(0, 4).map((link) => ({ id: link.id, group: "Payment links", label: link.title, hint: link.amount === null ? "Customer sets" : formatUsd(link.amount), href: `/dashboard/links/${link.id}/edit`, icon: RiLinksLine })),
      ...widgets.filter((widget) => matches(widget.name) || matches(widget.id)).slice(0, 4).map((widget) => ({ id: widget.id, group: "Widgets", label: widget.name, hint: widget.site, href: `/dashboard/widgets/${widget.id}/edit`, icon: RiLayoutMasonryLine })),
      ...payments.filter((payment) => matches(payment.id) || matches(payment.payer)).slice(0, 4).map((payment) => ({ id: payment.id, group: "Payments", label: payment.id, hint: formatUsd(payment.usd), href: `/dashboard/payments?q=${payment.id}`, icon: RiExchangeDollarLine })),
    ];
    return found.slice(0, RESULT_LIMIT);
  }, [query, links, widgets, payments]);

  const go = (entry: Entry | undefined) => {
    if (!entry) return;
    onClose();
    guardedPush(router, entry.href);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = (active + (event.key === "ArrowDown" ? 1 : -1) + results.length) % Math.max(results.length, 1);
      setActive(next);
      list.current?.children[next]?.scrollIntoView({ block: "nearest" });
    }
    if (event.key === "Enter") go(results[active]);
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-separator-border px-4 py-3">
        <RiSearchLine className="size-5 shrink-0 text-foreground-icon-tertiary" aria-hidden />
        <input
          ref={input}
          autoFocus
          role="combobox"
          aria-expanded
          aria-controls="palette-results"
          aria-activedescendant={results[active] ? `palette-${results[active].id}` : undefined}
          aria-label="Search pages, links, widgets and payments"
          placeholder="Search pages, links, widgets, payment IDs"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActive(0); }}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent text-body-regular text-text-primary outline-none placeholder:text-text-placeholder"
        />
      </div>
      {results.length === 0 ? (
        <p className="px-4 py-8 text-center text-body-regular text-text-secondary">Nothing matches that search.</p>
      ) : (
        <ul ref={list} id="palette-results" role="listbox" aria-label="Results" className="max-h-80 overflow-y-auto p-2">
          {results.map((entry, index) => (
            <li key={`${entry.group}-${entry.id}`} id={`palette-${entry.id}`} role="option" aria-selected={index === active}>
              <button type="button" tabIndex={-1} onPointerMove={() => setActive(index)} onClick={() => go(entry)} className={cx("flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-start outline-none", index === active && "bg-background-secondary-default")}>
                <entry.icon className="size-[18px] shrink-0 text-foreground-icon-tertiary" />
                <span className="min-w-0 flex-1 truncate text-body-medium text-text-primary">{entry.label}</span>
                {entry.hint && <span className="shrink-0 text-caption-1-regular text-text-secondary tabular-nums">{entry.hint}</span>}
                <span className="shrink-0 text-caption-1-regular text-text-tertiary">{entry.group}</span>
                {index === active && <RiArrowRightUpLine className="size-4 shrink-0 text-foreground-icon-tertiary" aria-hidden />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CommandPalette({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="md" aria-label="Search" overlayClassName="items-start pt-[12vh]" className="p-0">
      {/* Mounted only while open, so the query resets each time. */}
      {isOpen && <Palette onClose={() => onOpenChange(false)} />}
    </Modal>
  );
}
