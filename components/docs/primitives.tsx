"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { RiCheckLine, RiFileCopyLine, RiLinkM } from "@remixicon/react";
import { cx } from "@/utils/cx";
import { ALL_SECTIONS, SECTION_NUMBER } from "./sections";

const SECTION = Object.fromEntries(ALL_SECTIONS.map((section) => [section.id, section]));

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function useCopied() {
  const [copied, setCopied] = useState(false);
  return {
    copied,
    copy: async (text: string) => {
      if (!(await copyText(text))) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    },
  };
}

/** A section opens with its number, its group, its title (with a copyable link) and a one-line TL;DR. */
export function DocSection({ id, children }: { id: string; children: ReactNode }) {
  const meta = SECTION[id];
  const { copied, copy } = useCopied();
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="group/section scroll-mt-28 lg:scroll-mt-24">
      <div className="flex items-center gap-2.5">
        <span className="rounded-md border border-border-button-default px-1.5 py-0.5 font-mono text-caption-2-semibold text-text-secondary tabular-nums">{String(SECTION_NUMBER[id]).padStart(2, "0")}</span>
        <span className="text-caption-1-semibold tracking-wide text-text-tertiary uppercase">{meta.group}</span>
      </div>
      <h2 id={`${id}-h`} className="mt-3 flex items-center gap-2 text-title-1-semibold text-balance text-text-primary">
        {meta.title}
        <button
          type="button"
          aria-label={copied ? "Link copied" : `Copy link to ${meta.title}`}
          onClick={() => copy(`${window.location.origin}${window.location.pathname}#${id}`)}
          className="rounded-md p-1 text-foreground-icon-tertiary opacity-0 transition-opacity outline-none group-hover/section:opacity-100 hover:text-foreground-icon-primary focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-border-focus-ring"
        >
          {copied ? <RiCheckLine className="size-4" aria-hidden /> : <RiLinkM className="size-4" aria-hidden />}
        </button>
      </h2>
      <p className="mt-2 max-w-[60ch] text-headline-regular text-text-secondary">{meta.tldr}</p>
      <div className="mt-5 flex flex-col gap-4 text-body-regular text-text-primary [&_p]:max-w-[70ch]">{children}</div>
    </section>
  );
}

const TONE = {
  info: "bg-status-blue-background text-status-blue-text",
  warn: "bg-status-yellow-background text-status-yellow-text",
  good: "bg-status-lime-background text-status-lime-text",
} as const;

export function Callout({ tone = "info", title, children }: { tone?: keyof typeof TONE; title: string; children: ReactNode }) {
  return (
    <div className={cx("flex flex-col gap-1 rounded-2xl px-4 py-3", TONE[tone])} role="note">
      <p className="text-body-semibold">{title}</p>
      <div className="text-body-regular [&_code]:bg-transparent [&_code]:px-0">{children}</div>
    </div>
  );
}

export function Steps({ items }: { items: { title: string; body: ReactNode }[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {items.map((item, index) => (
        <li key={item.title} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
          <span aria-hidden className="flex size-8 items-center justify-center rounded-full border border-border-button-default text-caption-1-semibold tabular-nums text-text-secondary">{index + 1}</span>
          <div className="flex min-w-0 flex-col gap-2 pt-1">
            <p className="text-body-semibold">{item.title}</p>
            <div className="flex min-w-0 flex-col gap-3 text-text-secondary">{item.body}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Wraps on phones rather than scrolling: each row becomes a small card. */
export function Table({ head, rows, mono = 0 }: { head: string[]; rows: ReactNode[][]; mono?: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border-button-default">
      <table className="w-full border-collapse text-start text-body-2-regular">
        <thead className="hidden bg-background-secondary-default sm:table-header-group">
          <tr>
            {head.map((cell) => (
              <th key={cell} scope="col" className="px-3 py-2 text-start text-caption-1-semibold text-text-secondary">{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-separator-border">
          {rows.map((row, index) => (
            <tr key={index} className="flex flex-col gap-1 px-3 py-2.5 sm:table-row sm:p-0">
              {row.map((cell, column) => (
                <td key={column} className={cx("align-top sm:px-3 sm:py-2.5", column < mono && "font-mono text-caption-1-medium [overflow-wrap:anywhere] text-text-primary", column >= mono && "text-text-secondary")}>
                  <span className="sr-only sm:hidden">{head[column]}: </span>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const C = ({ children }: { children: ReactNode }) => <code dir="ltr" className="rounded-md bg-background-secondary-default px-1 py-0.5 font-mono text-[0.9em] [overflow-wrap:anywhere]">{children}</code>;

function CopyCode({ text }: { text: string }) {
  const { copied, copy } = useCopied();
  return (
    <button type="button" onClick={() => copy(text)} aria-label={copied ? "Copied" : "Copy code"} className="flex items-center gap-1 rounded-md px-2 py-1 text-caption-1-medium text-text-secondary outline-none hover:bg-background-tertiary-default hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring">
      {copied ? <RiCheckLine className="size-3.5" aria-hidden /> : <RiFileCopyLine className="size-3.5" aria-hidden />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** `<pre>` scrolls on its own, which is one of the two intentional horizontal scrollers. */
export function Code({ code, title }: { code: string; title?: string }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border-button-default bg-background-secondary-default">
      <div className="flex items-center justify-between gap-2 border-b border-separator-border py-1 ps-3 pe-1">
        <span className="truncate text-caption-1-medium text-text-secondary">{title ?? ""}</span>
        <CopyCode text={code} />
      </div>
      <pre dir="ltr" className="overflow-x-auto p-3 font-mono text-caption-1-regular leading-relaxed text-text-primary"><code>{code}</code></pre>
    </div>
  );
}

/* One language choice for the whole page, remembered: pick Python once and every example follows. */
const LANG_KEY = "gateway:docs-lang";
const listeners = new Set<() => void>();
let chosen: string | null = null;
function readLang() {
  if (chosen === null) {
    try {
      chosen = window.localStorage.getItem(LANG_KEY) ?? "";
    } catch {
      chosen = "";
    }
  }
  return chosen;
}
function setLang(lang: string) {
  chosen = lang;
  try {
    window.localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Without storage the choice lasts for this visit.
  }
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function CodeTabs({ tabs, title }: { tabs: { label: string; code: string }[]; title?: string }) {
  const lang = useSyncExternalStore(subscribe, readLang, () => "");
  const active = tabs.find((tab) => tab.label === lang) ?? tabs[0];
  return (
    <div className="overflow-hidden rounded-2xl border border-border-button-default bg-background-secondary-default">
      <div className="flex items-center justify-between gap-2 border-b border-separator-border py-1 ps-1 pe-1">
        <div role="tablist" aria-label={title ? `${title}, language` : "Language"} className="flex min-w-0 flex-wrap items-center gap-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.label}
              type="button"
              role="tab"
              aria-selected={tab === active}
              onClick={() => setLang(tab.label)}
              className={cx("rounded-md px-2 py-1 text-caption-1-medium outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring", tab === active ? "bg-background-primary-default text-text-primary shadow-xs" : "text-text-secondary hover:text-text-primary")}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <CopyCode text={active.code} />
      </div>
      <pre dir="ltr" role="tabpanel" aria-label={active.label} className="overflow-x-auto p-3 font-mono text-caption-1-regular leading-relaxed text-text-primary"><code>{active.code}</code></pre>
    </div>
  );
}

const METHOD_TONE: Record<string, string> = {
  GET: "bg-status-blue-background text-status-blue-text",
  POST: "bg-status-lime-background text-status-lime-text",
  PATCH: "bg-status-yellow-background text-status-yellow-text",
  DELETE: "bg-status-rose-background text-status-rose-text",
};

export function Method({ method }: { method: string }) {
  return <span className={cx("inline-flex w-14 shrink-0 justify-center rounded-md py-0.5 font-mono text-caption-2-bold", METHOD_TONE[method] ?? "bg-background-secondary-default")}>{method}</span>;
}

export function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="group rounded-2xl border border-border-button-default px-4 py-3 open:bg-background-primary-default">
      <summary className="cursor-pointer list-none text-body-semibold outline-none marker:hidden focus-visible:ring-2 focus-visible:ring-border-focus-ring [&::-webkit-details-marker]:hidden">
        <span className="me-2 inline-block text-text-tertiary transition-transform group-open:rotate-90" aria-hidden>›</span>
        {q}
      </summary>
      <div className="mt-2 flex flex-col gap-2 text-text-secondary">{children}</div>
    </details>
  );
}
