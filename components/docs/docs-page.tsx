"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { RiArrowRightUpLine, RiBookOpenLine, RiCloseLine, RiMenuLine, RiSearchLine } from "@remixicon/react";
import { Logo } from "@/components/brand/logo";
import { NavButton } from "@/components/nav-button";
import { OPENAPI } from "@/lib/openapi";
import { cx } from "@/utils/cx";
import { LinkBuilder, SignatureChecker, StatusMap, type StateRow } from "./interactives";
import { C, Callout, Code, CodeTabs, DocSection, Faq, Method, Steps, Table } from "./primitives";
import { ALL_SECTIONS, DOC_GROUPS, searchSections } from "./sections";

export interface AssetRow {
  symbol: string;
  name: string;
  chain: string;
  receivable: boolean;
  minimumUsd: number;
  closedLive: boolean;
}

export interface DocsProps {
  sandboxUrl: string;
  liveUrl: string;
  assets: AssetRow[];
  states: StateRow[];
  limits: { minUsd: number; maxUsd: number };
}

/**
 * The developer docs. Built, like DOKU's, for the three ways people read docs:
 *
 *   1. Looking one thing up: search (`/` focuses it) over titles, TL;DRs and the words people type, and
 *      every heading has a copyable link.
 *   2. Skimming: every section opens with a one-line TL;DR, so those alone summarise the product.
 *   3. Reading through: a tracked contents list, reading progress, and the parts people get wrong (the
 *      request, the signature, the statuses) as tools you use rather than paragraphs you imagine.
 *
 * The endpoint list and object fields are drawn from `server/openapi.ts`, which a test holds to the real
 * routes, and coins, minimums and states come from the code through `app/docs/page.tsx`.
 */

const IDS = ALL_SECTIONS.map((section) => section.id);

function reducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function goTo(id: string) {
  const element = document.getElementById(id);
  if (!element) return;
  element.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  history.replaceState(null, "", `#${id}`);
}

/**
 * The section being read and how far through the page the reader is, measured from scroll position. An
 * IntersectionObserver only reports changes, so a short section between two long ones could be skipped.
 */
function useReadingState() {
  const [active, setActive] = useState(IDS[0]);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      let current = IDS[0];
      for (const id of IDS) {
        const element = document.getElementById(id);
        if (element && element.getBoundingClientRect().top <= 160) current = id;
      }
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max > 0 && window.scrollY >= max - 4) current = IDS[IDS.length - 1];
      setActive(current);
      setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  return { active, progress };
}

/* ------------------------------------------------------------------ search and contents */

function Search({ onPick, shortcut }: { onPick: (id: string) => void; shortcut?: boolean }) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = searchSections(query);

  useEffect(() => {
    if (!shortcut) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (event.key !== "/" || target.closest("input, textarea, [contenteditable=true]")) return;
      event.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortcut]);

  const pick = (id: string) => {
    setQuery("");
    input.current?.blur();
    onPick(id);
  };

  return (
    <div className="relative">
      <label className="flex items-center gap-2 rounded-xl border border-border-button-default bg-background-primary-default px-3 py-2 focus-within:ring-2 focus-within:ring-border-focus-ring">
        <RiSearchLine className="size-4 shrink-0 text-foreground-icon-tertiary" aria-hidden />
        <input
          ref={input}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setCursor(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setCursor((value) => Math.min(value + 1, results.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setCursor((value) => Math.max(value - 1, 0));
            } else if (event.key === "Enter" && results[cursor]) {
              pick(results[cursor].id);
            } else if (event.key === "Escape") {
              setQuery("");
            }
          }}
          placeholder="Search the docs"
          aria-label="Search the docs"
          aria-expanded={results.length > 0}
          aria-controls="docs-search-results"
          role="combobox"
          aria-autocomplete="list"
          className="min-w-0 flex-1 bg-transparent text-body-regular text-text-primary outline-none placeholder:text-text-placeholder"
        />
        {shortcut && !query && <kbd className="rounded-md border border-border-button-default px-1.5 text-caption-2-medium text-text-tertiary">/</kbd>}
      </label>
      {query && (
        <ul id="docs-search-results" role="listbox" className="absolute inset-x-0 top-full z-40 mt-1 max-h-80 overflow-y-auto rounded-xl border border-border-button-default bg-background-primary-default p-1 shadow-lg">
          {results.length ? (
            results.map((section, index) => (
              <li key={section.id} role="option" aria-selected={index === cursor}>
                <button type="button" onMouseEnter={() => setCursor(index)} onClick={() => pick(section.id)} className={cx("flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-start", index === cursor && "bg-background-secondary-default")}>
                  <span className="text-body-medium text-text-primary">{section.title}</span>
                  <span className="text-caption-1-regular text-text-secondary">{section.tldr}</span>
                </button>
              </li>
            ))
          ) : (
            <li className="px-2.5 py-2 text-body-regular text-text-secondary">Nothing matches. Try &ldquo;webhook&rdquo; or &ldquo;refund&rdquo;.</li>
          )}
        </ul>
      )}
    </div>
  );
}

function Contents({ active, onPick }: { active: string; onPick: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-5">
      {DOC_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <p className="px-2 text-caption-1-semibold tracking-wide text-text-tertiary uppercase">{group.label}</p>
          <ul className="flex flex-col">
            {group.sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  aria-current={active === section.id ? "location" : undefined}
                  onClick={(event) => {
                    event.preventDefault();
                    onPick(section.id);
                  }}
                  className={cx("block rounded-lg px-2 py-1.5 text-body-2-medium outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring", active === section.id ? "bg-background-secondary-default text-text-primary" : "text-text-secondary hover:text-text-primary")}
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const Progress = ({ progress }: { progress: number }) => (
  <div aria-hidden className="h-0.5 overflow-hidden rounded-full bg-background-secondary-default">
    <div className="h-full origin-left bg-accent-500 motion-safe:transition-transform" style={{ transform: `scaleX(${progress})` }} />
  </div>
);

/** Phones: a sticky bar naming the section you're in, which opens search and the contents. */
function MobileBar({ active, progress }: { active: string; progress: number }) {
  const [open, setOpen] = useState(false);
  const title = ALL_SECTIONS.find((section) => section.id === active)?.title;
  const pick = (id: string) => {
    setOpen(false);
    window.setTimeout(() => goTo(id), 0);
  };
  return (
    <div className="sticky top-14 z-30 -mx-4 mb-8 border-b border-separator-border bg-background-full px-4 py-2 lg:hidden">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex w-full items-center justify-between gap-2 py-1 text-start outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring">
        <span className="min-w-0 truncate text-body-medium">{title}</span>
        {open ? <RiCloseLine className="size-5 shrink-0" aria-label="Close contents" /> : <RiMenuLine className="size-5 shrink-0" aria-label="Open contents" />}
      </button>
      <Progress progress={progress} />
      {open && (
        <div className="flex max-h-[70dvh] flex-col gap-4 overflow-y-auto pt-3 pb-2">
          <Search onPick={pick} />
          <Contents active={active} onPick={pick} />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ the page */

export function DocsPage(props: DocsProps) {
  const { active, progress } = useReadingState();

  // A deep link lands on its section once the page has laid out.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!IDS.includes(id)) return;
    const timer = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 60);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-dvh bg-background-full text-text-primary">
      <header className="sticky top-0 z-40 border-b border-separator-border bg-background-full/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/" aria-label="Gateway home" className="shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring">
              <Logo />
            </Link>
            <span className="text-body-medium text-text-tertiary">Docs</span>
          </div>
          <div className="flex items-center gap-2">
            <a href="/api/v1/openapi.json" className="hidden items-center gap-1 rounded-md px-2 py-1 text-body-2-medium text-text-secondary outline-none hover:text-text-primary focus-visible:ring-2 focus-visible:ring-border-focus-ring sm:flex">
              OpenAPI <RiArrowRightUpLine className="size-3.5" aria-hidden />
            </a>
            <NavButton href="/dashboard" variant="secondary" size="small">Dashboard</NavButton>
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1200px] gap-8 px-4 pt-8 pb-24 lg:grid-cols-[248px_minmax(0,1fr)] lg:gap-14 lg:pt-12">
        <aside className="hidden lg:block">
          <nav aria-label="Docs" className="sticky top-20 flex max-h-[calc(100dvh-6rem)] flex-col gap-4 overflow-y-auto pe-2 pb-6 [scrollbar-width:thin]">
            <Search onPick={goTo} shortcut />
            <div className="flex flex-col gap-1.5 px-2">
              <span className="text-caption-1-medium text-text-tertiary tabular-nums">{Math.round(progress * 100)}% read</span>
              <Progress progress={progress} />
            </div>
            <Contents active={active} onPick={goTo} />
          </nav>
        </aside>

        <main className="min-w-0 max-w-[820px]">
          <MobileBar active={active} progress={progress} />
          <Intro {...props} />
          <div className="flex flex-col gap-20">
            <Content {...props} />
          </div>
        </main>
      </div>
    </div>
  );
}

function BaseUrl({ label, url, note }: { label: string; url: string; note: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-2xl border border-border-button-default bg-background-primary-default px-4 py-3">
      <span className="text-caption-1-semibold tracking-wide text-text-tertiary uppercase">{label}</span>
      <code dir="ltr" className="font-mono text-body-2-medium [overflow-wrap:anywhere] text-text-primary">{url}</code>
      <span className="text-caption-1-regular text-text-secondary">{note}</span>
    </div>
  );
}

function Intro({ sandboxUrl, liveUrl }: DocsProps) {
  const paths: { id: string; title: string; body: string }[] = [
    { id: "hosted", title: "Hosted checkout", body: "Create a link per order, redirect, get a webhook." },
    { id: "popup", title: "Popup checkout", body: "One script. Customers stay on your page." },
    { id: "widget", title: "Embedded widget", body: "A script tag. No server needed." },
    { id: "reference", title: "API reference", body: "Every endpoint, and the OpenAPI file." },
  ];
  return (
    <header className="flex flex-col gap-6 pb-16">
      <div className="flex flex-col gap-3">
        <span className="flex items-center gap-2 text-caption-1-semibold tracking-wide text-text-tertiary uppercase"><RiBookOpenLine className="size-4" aria-hidden /> Developer docs</span>
        <h1 className="text-title-1-semibold text-balance sm:text-large-title-semibold">Take crypto in your app</h1>
        <p className="max-w-[62ch] text-headline-regular text-text-secondary">Customers pay with any supported coin, and you get the one you chose, in your own wallet. A few lines of code and a signed webhook. Gateway never holds the money, and your API key can&apos;t move it.</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {paths.map((path) => (
          <a
            key={path.id}
            href={`#${path.id}`}
            onClick={(event) => {
              event.preventDefault();
              goTo(path.id);
            }}
            className="flex flex-col gap-1 rounded-2xl border border-border-button-default bg-background-primary-default px-4 py-3 outline-none hover:border-border-button-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring"
          >
            <span className="text-body-semibold">{path.title}</span>
            <span className="text-body-2-regular text-text-secondary">{path.body}</span>
          </a>
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <BaseUrl label="Sandbox" url={sandboxUrl} note="Simulated payments. Build and test here." />
        <BaseUrl label="Live" url={liveUrl} note="Real money. Same API, new key." />
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ reference, from the OpenAPI description */

type Operation = { summary: string; description?: string; parameters?: { name: string; in: string; description?: string; schema?: { enum?: readonly string[] } }[]; requestBody?: unknown };

function Reference() {
  const methods = ["get", "post", "patch", "delete"] as const;
  const entries = Object.entries(OPENAPI.paths).flatMap(([path, item]) =>
    methods.filter((method) => method in item).map((method) => ({ path, method, operation: (item as Record<string, Operation>)[method] })),
  );
  return (
    <div className="flex flex-col gap-3">
      {entries.map(({ path, method, operation }) => (
        <div key={`${method} ${path}`} className="flex flex-col gap-2 rounded-2xl border border-border-button-default bg-background-primary-default px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Method method={method.toUpperCase()} />
            <code dir="ltr" className="font-mono text-body-2-medium [overflow-wrap:anywhere]">{path}</code>
          </div>
          <p className="text-body-medium">{operation.summary}</p>
          {operation.description && <p className="text-body-2-regular text-text-secondary">{operation.description}</p>}
          {operation.parameters?.some((parameter) => parameter.in === "query") && (
            <ul className="flex flex-col gap-1 text-body-2-regular text-text-secondary">
              {operation.parameters
                .filter((parameter) => parameter.in === "query")
                .map((parameter) => (
                  <li key={parameter.name}>
                    <C>{parameter.name}</C> {parameter.description ?? (parameter.schema?.enum ? `One of ${parameter.schema.enum.join(", ")}.` : "")}
                  </li>
                ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

type Property = { description?: string; type?: string | readonly string[]; enum?: readonly string[] };

function FieldTable({ schema }: { schema: "Payment" | "PaymentLink" }) {
  const properties = OPENAPI.components.schemas[schema].properties as Record<string, Property>;
  return (
    <Table
      head={["Field", "Type", "What it is"]}
      mono={1}
      rows={Object.entries(properties).map(([name, property]) => [name, Array.isArray(property.type) ? property.type.join(" or ") : property.enum ? property.enum.join(" | ") : (property.type ?? "object"), property.description ?? ""])}
    />
  );
}

/* ------------------------------------------------------------------ the content */

const usd = (value: number) => `$${value.toLocaleString("en-US")}`;

const P = ({ children }: { children: ReactNode }) => <p>{children}</p>;

function Content({ sandboxUrl, liveUrl, assets, states, limits }: DocsProps) {
  const script = `${sandboxUrl}/widget.js`;

  return (
    <>
      <DocSection id="overview">
        <P>Gateway takes a payment in one coin and delivers another. NEAR Intents routes it: the customer pays a one-time address, and the route converts the coins and sends the result to your settlement account or straight to your wallet.</P>
        <ol className="grid gap-2 sm:grid-cols-4">
          {[
            ["Your server", "creates a payment link for the order."],
            ["The customer", "pays with any supported coin."],
            ["Gateway", "tells your server, with a signed webhook."],
            ["Your wallet", "signs payouts and refunds."],
          ].map(([who, what], index) => (
            <li key={who} className="flex flex-col gap-1 rounded-2xl border border-border-button-default bg-background-primary-default px-3 py-3">
              <span className="text-caption-1-semibold text-text-tertiary tabular-nums">{index + 1}</span>
              <span className="text-body-semibold">{who}</span>
              <span className="text-body-2-regular text-text-secondary">{what}</span>
            </li>
          ))}
        </ol>
        <P>There are three ways to take a payment. They all end at the same webhook.</P>
        <Table
          head={["Way", "Best for", "You write"]}
          rows={[
            ["Hosted checkout", "Online orders and invoices", "One API call and a redirect"],
            ["Popup checkout", "Keeping customers on your page", "One API call and one script"],
            ["Embedded widget", "Tips, donations, fixed prices", "One script tag, no server"],
          ]}
        />
        <Callout tone="good" title="Non-custodial, by construction">Gateway never holds the money or your keys. An API key can create links and read payments. It can never move funds: payouts and refunds need your wallet&apos;s signature, in the dashboard.</Callout>
      </DocSection>

      <DocSection id="quickstart">
        <Steps
          items={[
            { title: "Sign in to the sandbox", body: <P>Go to <a className="text-text-accent underline" href={`${sandboxUrl}/login`}>{sandboxUrl.replace(/^https:\/\//, "")}/login</a> and make a workspace. Payments there are simulated, so nothing costs anything.</P> },
            { title: "Connect a settlement wallet", body: <P>In <strong>Settings</strong>, connect a wallet you control and sign the message. Checkout stays closed until a wallet is connected. Nothing is sent to it in the sandbox.</P> },
            { title: "Make an API key", body: <P>In <strong>Settings, Developers</strong>, create a key. It&apos;s shown once, so put it in your server&apos;s secrets as <C>GATEWAY_KEY</C>. Never ship it to a browser.</P> },
            {
              title: "Create a link",
              body: (
                <Code
                  title="Terminal"
                  code={`curl ${sandboxUrl}/api/v1/payment-links \\
  -H "Authorization: Bearer $GATEWAY_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Order 1234","amount":49,"receiveAsset":"USDC","metadata":{"order_id":"1234"}}'`}
                />
              ),
            },
            { title: "Pay it", body: <P>Open the <C>url</C> from the response. Pick a coin, enter any wallet address on that network, and press <strong>Simulate payment</strong>. There are buttons to underpay and to fail as well.</P> },
            { title: "See it arrive", body: <P>Read it back with <C>GET /api/v1/payments?link=lnk_…</C>, or add a webhook endpoint in <strong>Settings, Developers</strong> and watch <C>payment.settled</C> arrive.</P> },
          ]}
        />
      </DocSection>

      <DocSection id="environments">
        <Table
          head={["", "Sandbox", "Live"]}
          rows={[
            ["Base URL", <code key="s" dir="ltr" className="font-mono [overflow-wrap:anywhere]">{sandboxUrl}</code>, <code key="l" dir="ltr" className="font-mono [overflow-wrap:anywhere]">{liveUrl}</code>],
            ["Keys", <C key="s">gw_test_…</C>, <C key="l">gw_live_…</C>],
            ["Payments", "Simulated: buttons pay, underpay or fail", "Real coins on real networks"],
            ["Events", <C key="s">&quot;live&quot;: false</C>, <C key="l">&quot;live&quot;: true</C>],
          ]}
        />
        <P>The two are separate, with their own accounts, keys, links and webhook secrets. To go live, sign up there, connect the wallet you&apos;ll really use, make a new key and webhook endpoint, and change the base URL. Nothing else in your code changes.</P>
        <Callout tone="warn" title="Check live before you ship">Every payment and event says whether it was real. Refuse to fulfil a real order from one with <C>&quot;live&quot;: false</C>, so a test payment can never ship goods.</Callout>
      </DocSection>

      <DocSection id="hosted">
        <P>Your server creates a link for each order, with the order&apos;s id in <C>metadata</C>, and sends the customer to its <C>url</C>. Gateway runs the checkout. When it settles, your webhook hears about it with the same metadata.</P>
        <LinkBuilder baseUrl={sandboxUrl} />
        <Steps
          items={[
            { title: "Send the customer to link.url", body: <P>A plain redirect. The checkout works on phones and inside wallet browsers.</P> },
            {
              title: "Show the result when they come back",
              body: (
                <>
                  <P>After paying, the customer can return to your <C>successUrl</C>, which gets <C>payment_id</C> and <C>source_id</C> added. The id is only a reference, safe in a URL, and anyone can type one, so read the payment with your key before showing anything.</P>
                  <Code
                    title="Your thank-you page, Node"
                    code={`// GET /thanks?payment_id=pay_...
const id = encodeURIComponent(req.query.payment_id);
const payment = await fetch(\`\${GATEWAY}/api/v1/payments/\${id}\`, {
  headers: { Authorization: \`Bearer \${process.env.GATEWAY_KEY}\` },
}).then((response) => response.json());

if (payment.metadata?.order_id !== order.id) return notFound();
// "processing" is normal for a minute or two. The webhook confirms it.
render({ status: payment.status });`}
                  />
                </>
              ),
            },
            { title: "Fulfil on the webhook", body: <P>When <C>payment.settled</C> arrives with your <C>order_id</C>, ship. See <a className="text-text-accent underline" href="#fulfil" onClick={(event) => { event.preventDefault(); goTo("fulfil"); }}>Fulfil orders safely</a>.</P> },
          ]}
        />
        <Table
          head={["Option", "What it does"]}
          mono={1}
          rows={[
            ["singleUse", "Closes the link once a customer's money arrives, so an order can't be paid twice by accident. An address issued before that can't be withdrawn, so a customer still holding one is told not to send. If they send anyway, the money still reaches you: refund the extra payment."],
            ["Idempotency-Key", "Your order id, sent as a header. Retrying the request returns the same link instead of making a second one."],
            ["expiresAt", "Closes the link at a time you choose. A payment already under way still completes."],
            ["amount: null", "The customer types the amount, for tips and open invoices."],
          ]}
        />
      </DocSection>

      <DocSection id="popup">
        <P>Load one script from your Gateway and call <C>Gateway.checkout</C> from a click. Checkout opens in a small window over your page, and your page hears when it settles.</P>
        <Code
          title="Your page"
          code={`<script src="${script}"></script>

<button id="pay">Pay with crypto</button>
<script>
  document.getElementById("pay").addEventListener("click", () => {
    Gateway.checkout({
      // Your server creates the link (see Hosted checkout) and returns it.
      link: () => fetch("/orders/1234/crypto-link", { method: "POST" }).then((r) => r.json()),
      onSettled: () => showPaid(), // for your interface only
    }).then(() => {
      // The window closed. Your server knows from the webhook whether money is on its way,
      // so ask it rather than guessing here: never offer "try again" on close alone.
      refreshOrderStatus();
    });
  });
</script>`}
        />
        <Table
          head={["", ""]}
          rows={[
            ["link", <>A link id, its <C>url</C>, an object with either, or a function returning a promise of one. The window opens straight away, showing &ldquo;Opening checkout&rdquo; while your server answers, so popup blockers allow it.</>],
            ["onState", "Called as the payment moves: { paymentId, state, status }."],
            ["onSettled", "Called once when it settles."],
            ["Returns", "A promise that resolves when the window closes, with the last { paymentId, state, status } it reported."],
            ["Blocked popup", "If the browser blocks the window anyway, the page goes to checkout instead, and your successUrl brings the customer back."],
          ]}
        />
        <Callout tone="warn" title="Don't offer a second payment on close">A customer may close the window a moment after sending from another wallet app, before anything has arrived, so <C>status</C> can still be <C>processing</C> with money on its way. When the window closes, ask your server, which hears from the webhook. A one-payment link also refuses a second payment once money arrives.</Callout>
        <Callout tone="warn" title="Browser events are for your interface">They run on the customer&apos;s machine, so anyone can fake one. Show &ldquo;paid&rdquo; from them if you like, but ship from the webhook.</Callout>
      </DocSection>

      <DocSection id="widget">
        <P>A widget is a checkout you set up once in the dashboard (look, accepted coins, amount or presets) and drop into any page. The snippet only carries its id, so a page can&apos;t change what it charges.</P>
        <CodeTabs
          title="Embed a widget"
          tabs={[
            { label: "HTML", code: `<script src="${script}" data-widget="wgt_..." async></script>` },
            {
              label: "JavaScript",
              code: `// For single-page apps: mount into any element, and remove it when you're done.
const checkout = Gateway.mount(document.getElementById("checkout"), {
  widget: "wgt_...",
  onSettled: ({ paymentId }) => console.log("paid", paymentId),
});
// later: checkout.destroy();`,
            },
            {
              label: "React",
              code: `// Load ${script} once, in your HTML or with next/script.
import { useEffect, useRef } from "react";

export function Checkout({ widget }) {
  const host = useRef(null);
  useEffect(() => {
    const checkout = window.Gateway.mount(host.current, {
      widget,
      onSettled: ({ paymentId }) => console.log("paid", paymentId),
    });
    return () => checkout.destroy();
  }, [widget]);
  return <div ref={host} />;
}`,
            },
          ]}
        />
        <P>The widget also raises <C>gateway:state</C> and <C>gateway:settled</C> DOM events, which bubble up from where it sits. Set the widget&apos;s <strong>site</strong> in the dashboard, and only that site may frame it. Left empty, any site can.</P>
      </DocSection>

      <DocSection id="counter">
        <P>Turn on <strong>Show totals publicly</strong> for a link or widget, in its builder. Then anyone can read its settled total and count, and nothing else: no payers, no single amounts, no metadata. Refunded payments drop out.</P>
        <CodeTabs
          title="A counter on your site"
          tabs={[
            {
              label: "HTML",
              code: `<p>Raised so far: <span data-gateway-stats="lnk_..." data-show="both"></span></p>
<script src="${script}" async></script>

<!-- data-show: "raised" ($4,210), "payments" (37 payments) or "both" ($4,210 from 37 payments).
     It refreshes every minute while the page is visible. -->`,
            },
            { label: "JavaScript", code: `const { raised_usd, payments } = await Gateway.stats("lnk_...");` },
            {
              label: "Any client",
              code: `GET ${sandboxUrl}/api/checkout/lnk_.../stats

{ "source": "lnk_...", "raised_usd": 4210, "payments": 37, "currency": "USD", "live": true }`,
            },
          ]}
        />
        <P>For your own dashboards and reports, the stats endpoint gives the same figures as the Gateway dashboard, behind your key.</P>
        <Code
          title="Totals for a month"
          code={`curl "${sandboxUrl}/api/v1/stats?since=2026-11-01T00:00:00Z&until=2026-12-01T00:00:00Z" \\
  -H "Authorization: Bearer $GATEWAY_KEY"

{
  "live": false,
  "currency": "USD",
  "volume_usd": 1290.5,
  "payments": { "total": 31, "settled": 27, "processing": 1, "refunded": 1, "failed": 1, "expired": 1 },
  "success_rate": 0.9,
  "by_pay_asset": [{ "asset": "ETH", "volume_usd": 820, "payments": 14 }, ...]
}`}
        />
        <P>Success rate leaves in-flight payments out, because they have no outcome yet. Add <C>link=</C> for one link or widget.</P>
      </DocSection>

      <DocSection id="fulfil">
        <Steps
          items={[
            { title: "Ship on settled, from your server", body: <P>A <C>payment.settled</C> webhook whose signature checks out, or <C>GET /api/v1/payments/:id</C> returning <C>&quot;status&quot;: &quot;settled&quot;</C>. Nothing else.</P> },
            { title: "Check it's the right payment", body: <P><C>live</C> matches your environment, <C>metadata.order_id</C> is the order, and <C>receive.amount_base</C> is what you expect.</P> },
            { title: "Be ready for repeats", body: <P>An event can arrive twice, or out of order. Record the payment id when you ship and skip one you&apos;ve seen.</P> },
            { title: "Never ship on these", body: <P>A browser event, the <C>payment_id</C> on your success URL, or the customer&apos;s &ldquo;Payment complete&rdquo; screen. All of them can be faked.</P> },
            { title: "Expired isn't final", body: <P>Money that arrives after the timer can still settle. If you&apos;d already cancelled the order, refund it from the dashboard.</P> },
          ]}
        />
      </DocSection>

      <DocSection id="conventions">
        <Table
          head={["", ""]}
          rows={[
            ["Authentication", <>Send <C>Authorization: Bearer gw_…</C>. Keys belong to a workspace; make and revoke them in Settings, Developers. A key reads payments and manages links, and can never move money.</>],
            ["Limits", "600 requests a minute per key. Over that you get 429, rate_limited."],
            ["Errors", <><C>{`{"error":{"code","message"}}`}</C> with a matching status, plus <C>issues</C> naming each bad field on a 400.</>],
            ["Idempotency", <>Send <C>Idempotency-Key</C> on creates. A retry returns the first response with <C>Idempotent-Replay: true</C>. The same key with a different body is 409, idempotency_mismatch. A request that failed frees its key. Keys are kept for 7 days.</>],
            ["Amounts", <>Prices are USD numbers. Coin amounts are <C>amount_base</C>: integer strings in the coin&apos;s smallest unit, with <C>decimals</C> beside them. Read them as big integers, never floats.</>],
            ["Pages", <>Lists return <C>has_more</C>. Pass the last id as <C>starting_after</C> for the next page.</>],
            ["Changes", "New fields, events and states can appear without notice. Ignore what you don't know rather than failing on it."],
          ]}
        />
        <Table
          head={["Code", "Status", "Means"]}
          mono={1}
          rows={[
            ["invalid_input", "400", "A field is missing or wrong. issues says which."],
            ["invalid_query", "400", "A query parameter is wrong."],
            ["unauthorized", "401", "No key, a wrong one, or one that was revoked."],
            ["not_found", "404", "Not in this workspace."],
            ["idempotency_mismatch", "409", "That Idempotency-Key was used for a different request."],
            ["idempotency_in_progress", "409", "The first request with that key is still running. Retry shortly."],
            ["rate_limited", "429", "Slow down for a moment."],
          ]}
        />
      </DocSection>

      <DocSection id="reference">
        <P>
          All paths are under your base URL. The same list, with every field, is in{" "}
          <a className="text-text-accent underline" href="/api/v1/openapi.json">openapi.json</a>: import it into Postman or Insomnia, or generate a client from it.
        </P>
        <Reference />
      </DocSection>

      <DocSection id="objects">
        <P>The same object comes back from the API and inside every <C>payment.*</C> webhook.</P>
        <FieldTable schema="Payment" />
        <Code
          title="A settled payment"
          code={`{
  "id": "pay_3kq9z7m2x1",
  "status": "settled",
  "state": "settled",
  "live": true,
  "source": { "type": "link", "id": "lnk_8fk2m1", "name": "Order 1234" },
  "amount_usd": 49,
  "pay": { "asset": "ETH", "chain": "Ethereum", "amount_base": "15041311475409836", "decimals": 18 },
  "receive": { "asset": "USDC", "chain": "Base", "amount_base": "49000000", "decimals": 6 },
  "payer": "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
  "customer_email": null,
  "metadata": { "order_id": "1234" },
  "origin_tx_hashes": ["0x…"],
  "destination_tx_hashes": [],
  "created_at": "2026-11-09T10:00:00.000Z",
  "settled_at": "2026-11-09T10:01:12.000Z"
}`}
        />
        <P>A payment link, from the API:</P>
        <FieldTable schema="PaymentLink" />
      </DocSection>

      <DocSection id="webhooks">
        <P>Add an endpoint in <strong>Settings, Developers</strong>: a public https URL and the events you want. Its signing secret is shown once. Use the test button to send a <C>ping</C>.</P>
        <Table
          head={["Header", "Value"]}
          mono={1}
          rows={[
            ["Gateway-Event", "The event type, such as payment.settled."],
            ["Gateway-Event-Id", "evt_…, the same on every retry. De-duplicate on it."],
            ["Gateway-Signature", "t=<unix seconds>,v1=<hex HMAC-SHA256>. See Check a signature."],
            ["Gateway-Delivery", "The delivery's id, the same on every retry. Quote it to support."],
            ["User-Agent", "Gateway-Webhooks/1"],
          ]}
        />
        <Code
          title="The body"
          code={`{
  "id": "evt_5ab21c",
  "type": "payment.settled",
  "created_at": "2026-11-09T10:01:12.000Z",
  "data": { "id": "pay_3kq9z7m2x1", "status": "settled", "live": true, "metadata": { "order_id": "1234" }, ... }
}`}
        />
        <Table
          head={["", ""]}
          rows={[
            ["Answer", "Any 2xx within 10 seconds. Do slow work after you answer."],
            ["Retries", "After 1 minute, 5 minutes, 30 minutes, 2 hours, 6 hours and 24 hours: seven tries over about 33 hours. Then it's marked failed, you're notified, and you can resend it from Settings."],
            ["Order", "Not guaranteed. Read status from the event, or from the API, rather than assuming the order they came in."],
            ["Addresses", "Endpoints must be public. Private and internal addresses are refused, including after DNS changes."],
          ]}
        />
      </DocSection>

      <DocSection id="verify">
        <P>The signature is an HMAC-SHA256 of the timestamp, a dot, and the <strong>raw</strong> body, keyed with your endpoint&apos;s whole secret, <C>whsec_</C> included. Check it before trusting anything in the event, and refuse a timestamp more than five minutes old, so a captured request can&apos;t be replayed.</P>
        <CodeTabs
          title="Verify a webhook"
          tabs={[
            {
              label: "Node",
              code: `import express from "express";
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(rawBody, header, secret) {
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=")));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = createHmac("sha256", secret).update(\`\${t}.\${rawBody}\`).digest();
  const given = Buffer.from(parts.v1 ?? "", "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const app = express();
// The raw body, not parsed JSON: the signature covers the exact bytes.
app.post("/webhooks/gateway", express.raw({ type: "application/json" }), (req, res) => {
  const raw = req.body.toString("utf8");
  if (!verify(raw, req.get("Gateway-Signature") ?? "", process.env.GATEWAY_WEBHOOK_SECRET)) return res.sendStatus(400);
  const event = JSON.parse(raw);
  if (event.type === "payment.settled" && event.data.live) markPaid(event.data.metadata.order_id, event.data.id);
  res.sendStatus(200);
});`,
            },
            {
              label: "Python",
              code: `import hashlib, hmac, json, os, time
from flask import Flask, abort, request

app = Flask(__name__)

def verify(raw: bytes, header: str, secret: str) -> bool:
    parts = dict(part.split("=", 1) for part in header.split(",") if "=" in part)
    try:
        t = int(parts.get("t", ""))
    except ValueError:
        return False
    if abs(time.time() - t) > 300:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, parts.get("v1", ""))

@app.post("/webhooks/gateway")
def gateway_webhook():
    raw = request.get_data()  # the raw bytes, before any JSON parsing
    if not verify(raw, request.headers.get("Gateway-Signature", ""), os.environ["GATEWAY_WEBHOOK_SECRET"]):
        abort(400)
    event = json.loads(raw)
    if event["type"] == "payment.settled" and event["data"]["live"]:
        mark_paid(event["data"]["metadata"].get("order_id"), event["data"]["id"])
    return "", 200`,
            },
            {
              label: "PHP",
              code: `<?php
$raw = file_get_contents('php://input');
parse_str(str_replace(',', '&', $_SERVER['HTTP_GATEWAY_SIGNATURE'] ?? ''), $parts);
$t = isset($parts['t']) ? (int) $parts['t'] : 0;
$expected = hash_hmac('sha256', $t . '.' . $raw, getenv('GATEWAY_WEBHOOK_SECRET'));

if (!$t || abs(time() - $t) > 300 || !hash_equals($expected, $parts['v1'] ?? '')) {
  http_response_code(400);
  exit;
}

$event = json_decode($raw, true);
if ($event['type'] === 'payment.settled' && $event['data']['live']) {
  mark_paid($event['data']['metadata']['order_id'] ?? null, $event['data']['id']);
}
http_response_code(200);`,
            },
            {
              label: "Go",
              code: `import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"
)

func verify(raw []byte, header, secret string) bool {
	var t int64
	var v1 string
	for _, part := range strings.Split(header, ",") {
		key, value, _ := strings.Cut(part, "=")
		switch key {
		case "t":
			t, _ = strconv.ParseInt(value, 10, 64)
		case "v1":
			v1 = value
		}
	}
	age := time.Now().Unix() - t
	if t == 0 || age > 300 || age < -300 {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	fmt.Fprintf(mac, "%d.", t)
	mac.Write(raw)
	given, err := hex.DecodeString(v1)
	return err == nil && hmac.Equal(given, mac.Sum(nil))
}`,
            },
          ]}
        />
        <P>Check yours against this. Paste a real delivery from your logs, or make a signed sample to test your own code with.</P>
        <SignatureChecker />
      </DocSection>

      <DocSection id="events">
        <Table
          head={["Event", "When", "What to do"]}
          mono={1}
          rows={[
            ["payment.processing", "The customer's coins arrived and are being routed.", "Show “received, confirming”. Don't ship yet."],
            ["payment.settled", "You have the money.", "Ship."],
            ["payment.underpaid", "Less than the quote arrived, and you hold what did.", "Your policy: ask for the rest, or refund it."],
            ["payment.failed", "The route couldn't complete. The deposit goes back to the customer.", "Let them try again."],
            ["payment.expired", "Nothing arrived in time.", "Release the stock. It isn't final: settled can still follow."],
            ["payment.refunded", "You refunded it. data.refund says how much and whether it was whole.", "Reverse the order."],
            ["payout.sent", "A payout reached its destination.", "Reconcile."],
            ["payout.failed", "A payout didn't complete. The money stays in your balance.", "Try again from the dashboard."],
            ["link.created", "A link was made, from the dashboard or the API.", ""],
            ["ping", "You pressed the test button.", "Answer 2xx."],
          ]}
        />
      </DocSection>

      <DocSection id="lifecycle">
        <P>Branch on <C>status</C>. It only ever takes these five values. <C>state</C> is the finer detail behind it, for logs and support, and can gain new values.</P>
        <StatusMap states={states} />
        <P>An address that was issued but hasn&apos;t been paid isn&apos;t listed and sends nothing while it waits. If its timer runs out it becomes <C>expired</C>: from then on it&apos;s listed, sends <C>payment.expired</C>, and counts in stats, as in the dashboard.</P>
      </DocSection>

      <DocSection id="assets">
        <Table
          head={["Coin", "Network", "Customers pay", "You receive", "Route minimum"]}
          mono={1}
          rows={assets.map((asset) => [
            asset.symbol,
            asset.chain,
            asset.closedLive ? "Sandbox only, for now" : "Yes",
            asset.receivable ? "Yes" : "",
            asset.minimumUsd ? usd(asset.minimumUsd) : "None",
          ])}
        />
        <P>
          Payments run from {usd(limits.minUsd)} to {usd(limits.maxUsd)}. Some networks have a temporary minimum set by NEAR Intents, shown above. Checkout explains it to the customer and offers the other coins.
          {assets.some((asset) => asset.closedLive) && " Bitcoin is closed for real payments until its quotes can be verified."}
        </P>
        <P>Prices are set in USD. Whatever the customer pays with, you receive the coin you chose for the link, at the quoted amount.</P>
      </DocSection>

      <DocSection id="money">
        <Table
          head={["", ""]}
          rows={[
            ["Settlement", "Payments land in a settlement balance your wallet controls (the default), or straight in your wallet for USDC on Base and ETH. Choose in Settings."],
            ["Payouts", "From the dashboard, on a schedule or by hand. Your wallet signs each one. GET /api/v1/payouts lists them."],
            ["Refunds", "From a payment in the dashboard, whole or in part. From a balance your wallet signs it; for money paid straight to your wallet, you send it from your wallet to a one-time refund address. payment.refunded follows."],
            ["Costs", "Routing costs are inside the customer's quote, shown at checkout before they pay. If a payment has to be returned, the route's network fee comes out of the deposit, and checkout says so."],
          ]}
        />
        <Callout title="Why a key can't refund">A refund moves money, and only your wallet can sign that. It means a leaked key can read your payments and make links, but can never send anything anywhere.</Callout>
      </DocSection>

      <DocSection id="golive">
        <ul className="flex flex-col gap-2">
          {[
            <>Sign up at <C>{liveUrl}</C> and connect the wallet you&apos;ll actually use. It must be a normal wallet (an EOA), not a smart-contract wallet.</>,
            <>Make a <C>gw_live_</C> key and a new webhook endpoint, and put both secrets in your server&apos;s environment.</>,
            <>Change the base URL, and the script&apos;s <C>src</C>, to the live one.</>,
            <>Refuse to fulfil anything with <C>&quot;live&quot;: false</C>.</>,
            <>Point success URLs at your real pages, and set each widget&apos;s site.</>,
            <>Take one small real payment end to end, and refund it.</>,
          ].map((item, index) => (
            <li key={index} className="flex items-start gap-2.5">
              <span aria-hidden className="mt-1 size-4 shrink-0 rounded border border-border-button-default" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </DocSection>

      <DocSection id="faq">
        <div className="flex flex-col gap-2">
          <Faq q="Does Gateway hold my money?"><P>No. Payments go to a balance your wallet controls, or to your wallet directly, and only your wallet can move them.</P></Faq>
          <Faq q="What can someone do with a leaked API key?"><P>Read your payments and payouts, and create or change links. Not move money. Revoke it in Settings, Developers, and make a new one.</P></Faq>
          <Faq q="What if the customer sends too much or too little?"><P>More than the quote: the route converts what&apos;s needed and returns the rest to the customer. Less than the quote&apos;s minimum: the route returns it by the deadline. If the route completes but less than quoted reaches you, you get <C>payment.underpaid</C> and keep what arrived.</P></Faq>
          <Faq q="How long does a payment take?"><P>About a minute on most routes, by NEAR Intents&apos; own estimate. Listen for <C>payment.settled</C> rather than waiting a fixed time.</P></Faq>
          <Faq q="Can the browser set metadata?"><P>No, on purpose. Metadata comes from your server, on the link, so a customer can&apos;t change the order a payment is for.</P></Faq>
          <Faq q="Is there a test mode on the live site?"><P>No. The sandbox is the test mode. Keeping them apart means a test payment can never touch real money.</P></Faq>
          <Faq q="Which wallets can customers pay from?"><P>Any wallet on the chosen network. Exchange accounts may not receive a returned deposit, so checkout asks for a wallet the customer controls.</P></Faq>
        </div>
      </DocSection>
    </>
  );
}
