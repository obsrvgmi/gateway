/**
 * The docs' table of contents, and the search index over it.
 *
 * `tldr` opens each section and doubles as the search result's subtitle, so reading only the TL;DRs is
 * a complete summary. `keywords` are words people type that the title doesn't contain.
 */
export interface DocSectionMeta {
  id: string;
  title: string;
  tldr: string;
  keywords?: string[];
}

export interface DocGroup {
  label: string;
  sections: DocSectionMeta[];
}

export const DOC_GROUPS: DocGroup[] = [
  {
    label: "Start here",
    sections: [
      { id: "overview", title: "How Gateway works", tldr: "Customers pay with any supported coin. You receive the one you chose, in your own wallet.", keywords: ["intro", "non-custodial", "near", "intents", "about"] },
      { id: "quickstart", title: "Quickstart", tldr: "A key, one request, and a test payment: about five minutes.", keywords: ["start", "first", "tutorial", "curl", "hello"] },
      { id: "environments", title: "Sandbox and live", tldr: "Build against the sandbox, where payments are simulated. Going live is a new URL and key.", keywords: ["test", "test mode", "staging", "production", "gw_test", "gw_live"] },
    ],
  },
  {
    label: "Take payments",
    sections: [
      { id: "hosted", title: "Hosted checkout", tldr: "Your server creates a link for the order and sends the customer to it. The simplest way in.", keywords: ["redirect", "order", "shop", "ecommerce", "link", "success url", "metadata"] },
      { id: "popup", title: "Checkout in a popup", tldr: "One script and one call. The customer never leaves your page.", keywords: ["modal", "gateway.checkout", "javascript", "frontend", "spa", "button"] },
      { id: "widget", title: "Embedded widget", tldr: "A checkout that lives in your page, for tips, donations and fixed prices.", keywords: ["iframe", "embed", "react", "vue", "mount", "script tag", "widget.js"] },
      { id: "counter", title: "Totals and stats", tldr: "Show a raised-so-far counter on your site, or pull your figures into your own tools.", keywords: ["stats", "analytics", "counter", "donations", "raised", "volume", "dashboard"] },
      { id: "fulfil", title: "Fulfil orders safely", tldr: "Ship on a signed webhook or an API read. Never on a redirect or a browser event.", keywords: ["security", "trust", "ship", "deliver", "verify", "settled"] },
    ],
  },
  {
    label: "API",
    sections: [
      { id: "conventions", title: "Keys, errors and retries", tldr: "A bearer key, JSON in and out, an Idempotency-Key on creates, and amounts as integer strings.", keywords: ["auth", "authentication", "bearer", "rate limit", "idempotency", "pagination", "errors", "429"] },
      { id: "reference", title: "Endpoints", tldr: "Links, payments, payouts and stats. The same list as the OpenAPI file.", keywords: ["rest", "openapi", "swagger", "postman", "routes", "payment-links", "payments", "payouts"] },
      { id: "objects", title: "The payment object", tldr: "What every payment looks like, in the API and in webhooks.", keywords: ["fields", "schema", "json", "amount_base", "status"] },
    ],
  },
  {
    label: "Webhooks",
    sections: [
      { id: "webhooks", title: "Receive webhooks", tldr: "A signed POST for each change. Return a 2xx; we retry for over a day.", keywords: ["endpoint", "events", "retry", "headers", "deliveries"] },
      { id: "verify", title: "Check a signature", tldr: "An HMAC of the timestamp and the raw body. Check it, and refuse anything older than five minutes.", keywords: ["hmac", "sha256", "signature", "security", "node", "python", "php", "express"] },
      { id: "events", title: "Events", tldr: "Nine events, and what each one means for an order.", keywords: ["payment.settled", "payment.failed", "payout.sent", "types", "list"] },
    ],
  },
  {
    label: "Payments",
    sections: [
      { id: "lifecycle", title: "Payment statuses", tldr: "Five statuses for your code, and the finer states behind them.", keywords: ["state", "expired", "underpaid", "processing", "status map"] },
      { id: "assets", title: "Coins and limits", tldr: "What customers can pay with, what you can receive, and each route's minimum.", keywords: ["chains", "assets", "tokens", "usdc", "eth", "minimum", "maximum", "bitcoin"] },
      { id: "money", title: "Payouts and refunds", tldr: "Your wallet signs every move of money. A key can only read them.", keywords: ["payout", "refund", "settlement", "balance", "wallet", "custody", "fees"] },
    ],
  },
  {
    label: "Launch",
    sections: [
      { id: "golive", title: "Going live", tldr: "A short checklist before you point customers at real money.", keywords: ["launch", "production", "checklist", "mainnet"] },
      { id: "faq", title: "Questions", tldr: "The things people ask before and after their first payment.", keywords: ["faq", "help", "support", "why"] },
    ],
  },
];

export const ALL_SECTIONS = DOC_GROUPS.flatMap((group) => group.sections.map((section) => ({ ...section, group: group.label })));

export const SECTION_NUMBER: Record<string, number> = Object.fromEntries(ALL_SECTIONS.map((section, index) => [section.id, index + 1]));

/** Title matches first, then TL;DR and keywords. Every word must match somewhere. */
export function searchSections(query: string) {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return ALL_SECTIONS.map((section) => {
    const title = section.title.toLowerCase();
    const rest = `${section.tldr} ${(section.keywords ?? []).join(" ")} ${section.group}`.toLowerCase();
    if (!words.every((word) => title.includes(word) || rest.includes(word))) return null;
    return { section, score: words.filter((word) => title.includes(word)).length };
  })
    .filter((hit): hit is NonNullable<typeof hit> => hit !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((hit) => hit.section);
}
