import { quote } from "./assets";
import type { AssetSymbol, GatewayState, Payment, PaymentLink, PaymentStatus, Widget } from "./types";

/** Every mock date and metric window is measured from this instant. */
export const DEMO_NOW = Date.UTC(2026, 10, 5, 18, 0, 0);
const DAY = 86_400_000;
const daysAgo = (days: number) => new Date(DEMO_NOW - days * DAY).toISOString();

const LINKS: PaymentLink[] = [
  { id: "lnk_8fk2m1", title: "Brand sprint deposit", description: "50% deposit for the December brand sprint.", amount: 2400, receiveAsset: "USDC", status: "active", expiresAt: null, successUrl: "https://lumen.studio/thanks", createdAt: daysAgo(612) },
  { id: "lnk_q3v9xa", title: "Design retainer", description: "Monthly retainer, billed in advance.", amount: 4800, receiveAsset: "USDC", status: "active", expiresAt: null, successUrl: "https://lumen.studio/thanks", createdAt: daysAgo(724) },
  { id: "lnk_t7h4zp", title: "Type specimen, print run", description: "Limited edition of 200.", amount: 79, receiveAsset: "USDT", status: "active", expiresAt: "2026-12-20T00:00:00.000Z", successUrl: "", createdAt: daysAgo(364) },
  { id: "lnk_c1n6ds", title: "Tip jar", description: "Pay what you like.", amount: null, receiveAsset: "USDC", status: "active", expiresAt: null, successUrl: "", createdAt: daysAgo(728) },
  { id: "lnk_w2j5ke", title: "Workshop seat, Lisbon", description: "One seat, lunch included.", amount: 480, receiveAsset: "USDC", status: "expired", expiresAt: "2026-10-01T00:00:00.000Z", successUrl: "", createdAt: daysAgo(220) },
  { id: "lnk_b9r3ly", title: "Icon set license", description: "Commercial license, one seat.", amount: 120, receiveAsset: "NEAR", status: "paused", expiresAt: null, successUrl: "", createdAt: daysAgo(496) },
  { id: "lnk_f4d8ug", title: "Annual support plan", description: "Priority support for twelve months.", amount: 960, receiveAsset: "USDC", status: "active", expiresAt: null, successUrl: "https://lumen.studio/thanks", createdAt: daysAgo(540) },
  { id: "lnk_h6y2ob", title: "Consultation hour", description: "One hour with a senior designer.", amount: 180, receiveAsset: "USDC", status: "active", expiresAt: null, successUrl: "https://lumen.studio/booked", createdAt: daysAgo(430) },
  { id: "lnk_m5s1rc", title: "Template pack, volume two", description: "Forty layouts with source files.", amount: 49, receiveAsset: "ETH", status: "active", expiresAt: null, successUrl: "", createdAt: daysAgo(305) },
  { id: "lnk_v8e3tn", title: "Studio zine, issue four", description: "Printed and shipped worldwide.", amount: 18, receiveAsset: "USDT", status: "active", expiresAt: "2026-11-24T00:00:00.000Z", successUrl: "", createdAt: daysAgo(58) },
  { id: "lnk_k2p7wq", title: "Extended commercial license for the complete type family, all weights and optical sizes", description: "Web, print and app use for teams of up to fifty.", amount: 12500, receiveAsset: "USDC", status: "active", expiresAt: null, successUrl: "https://lumen.studio/thanks", createdAt: daysAgo(268) },
];

/** Days ago each seeded link stopped taking payments, and how often it is chosen. */
const LINK_TRAITS: Record<string, { weight: number; closedDaysAgo?: number }> = {
  lnk_8fk2m1: { weight: 0.5 },
  lnk_q3v9xa: { weight: 0.3 },
  lnk_t7h4zp: { weight: 6 },
  lnk_c1n6ds: { weight: 5 },
  lnk_w2j5ke: { weight: 3.2, closedDaysAgo: 35 },
  lnk_b9r3ly: { weight: 3.5, closedDaysAgo: 18 },
  lnk_f4d8ug: { weight: 1.2 },
  lnk_h6y2ob: { weight: 3.4 },
  lnk_m5s1rc: { weight: 5 },
  lnk_v8e3tn: { weight: 6 },
  lnk_k2p7wq: { weight: 0.025 },
};

const WIDGETS: Widget[] = [
  { id: "wgt_shop01", name: "Storefront checkout", site: "shop.lumen.studio", status: "live", theme: "light", accent: "#00EC97", radius: "rounded", amount: null, receiveAsset: "USDC", buttonLabel: "Pay now", showBranding: true, createdAt: daysAgo(726) },
  { id: "wgt_docs02", name: "Docs donation", site: "docs.lumen.studio", status: "live", theme: "dark", accent: "#7c3aed", radius: "soft", amount: 25, receiveAsset: "USDC", buttonLabel: "Support us", showBranding: true, createdAt: daysAgo(450) },
  { id: "wgt_lrn03", name: "Course enrollment", site: "learn.lumen.studio", status: "live", theme: "auto", accent: "#059669", radius: "rounded", amount: 290, receiveAsset: "USDC", buttonLabel: "Enroll", showBranding: false, createdAt: daysAgo(330) },
  { id: "wgt_mem04", name: "Membership renewal", site: "club.lumen.studio", status: "paused", theme: "light", accent: "#ea580c", radius: "sharp", amount: 120, receiveAsset: "USDT", buttonLabel: "Renew", showBranding: true, createdAt: daysAgo(280) },
];

const WIDGET_TRAITS: Record<string, { weight: number; closedDaysAgo?: number }> = {
  wgt_shop01: { weight: 13 },
  wgt_docs02: { weight: 5 },
  wgt_lrn03: { weight: 3.2 },
  wgt_mem04: { weight: 2.6, closedDaysAgo: 12 },
};

// Small seeded PRNG, so server and client render identical mock data.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Slower chains need more confirmations before the route can settle. */
const SETTLE_RANGE: Partial<Record<AssetSymbol, [number, number]>> = {
  BTC: [31, 48],
  ETH: [22, 36],
  NEAR: [14, 24],
  SOL: [15, 26],
  ARB: [17, 28],
};

export function settleRange(asset: AssetSymbol): [number, number] {
  return SETTLE_RANGE[asset] ?? [18, 32];
}

function generatePayments(): Payment[] {
  const random = mulberry32(4821);
  const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)];
  const amounts = [29, 49, 79, 79, 120, 120, 240, 480, 950];
  const assets: AssetSymbol[] = ["ETH", "ETH", "ETH", "ETH", "SOL", "SOL", "SOL", "BTC", "BTC", "USDT", "USDT", "USDC", "NEAR", "BNB", "ARB"];
  const hex = "0123456789abcdef".split("");
  const address = () => `0x${Array.from({ length: 40 }, () => pick(hex)).join("")}`;
  const regulars = Array.from({ length: 180 }, address);
  const usedIds = new Set<string>();
  const payments: Payment[] = [];

  const sources = [
    ...LINKS.map((source) => ({ source, kind: "link" as const, ...LINK_TRAITS[source.id] })),
    ...WIDGETS.map((source) => ({ source, kind: "widget" as const, ...WIDGET_TRAITS[source.id] })),
  ];

  const push = (at: number, forced?: PaymentStatus) => {
    const age = (DEMO_NOW - at) / DAY;
    const open = sources.filter((item) => DEMO_NOW - new Date(item.source.createdAt).getTime() > age * DAY && age >= (item.closedDaysAgo ?? 0));
    // History can start before the first source existed; nothing could have been paid then.
    if (open.length === 0) return;
    const total = open.reduce((sum, item) => sum + item.weight, 0);
    let roll = random() * total;
    const chosen = open.find((item) => (roll -= item.weight) <= 0) ?? open[0];
    const { source, kind } = chosen;
    const usd = source.amount ?? pick(amounts);
    const payAsset = pick(assets);
    const { payAmount, receiveAmount } = quote(usd, payAsset, source.receiveAsset);
    const outcome = random();
    const status: PaymentStatus = forced ?? (outcome < 0.93 ? "settled" : outcome < 0.965 ? "refunded" : "expired");
    const [fastest, slowest] = settleRange(payAsset);
    let id = "";
    do id = `pay_${(100000 + Math.floor(random() * 2_000_000_000)).toString(36)}`;
    while (usedIds.has(id));
    usedIds.add(id);
    const settleSeconds = status === "settled" || status === "refunded" ? fastest + Math.floor(random() * (slowest - fastest + 1)) : null;
    payments.push({
      id,
      sourceType: kind,
      sourceId: source.id,
      sourceName: kind === "link" ? (source as PaymentLink).title : (source as Widget).name,
      payAsset,
      payAmount,
      receiveAsset: source.receiveAsset,
      receiveAmount,
      usd,
      status,
      payer: random() < 0.45 ? pick(regulars) : address(),
      settleSeconds,
      createdAt: new Date(at).toISOString(),
      ...(status === "refunded" ? { refundedAt: new Date(at + (1 + Math.floor(random() * 3)) * DAY).toISOString() } : {}),
    });
  };

  // Two years of history: enough to compare any range to the same days a year earlier.
  for (let age = 0; age < 730; age++) {
    const dayStart = DEMO_NOW - DEMO_NOW % DAY - age * DAY;
    const weekday = new Date(dayStart).getUTCDay();
    const rhythm = weekday === 0 || weekday === 6 ? 0.55 : weekday === 2 || weekday === 3 ? 1.25 : 1;
    const growth = 1.1 + 3.4 * (1 - age / 730) ** 1.4;
    const season = 1 + 0.22 * Math.sin((age / 365) * 2 * Math.PI + 1);
    const expected = growth * rhythm * season;
    const count = Math.floor(expected + random() * 1.4);
    for (let index = 0; index < count; index++) {
      // Payments cluster around 15:00 UTC, the overlap of the European and American day.
      const hour = (15 + (random() + random() + random() - 1.5) * 10 + 24) % 24;
      const at = dayStart + Math.floor(hour * 3_600_000);
      // A refund can only exist once its date has passed, so recent days only settle or expire.
      if (at < DEMO_NOW - 15 * 60_000) push(at);
    }
  }

  push(DEMO_NOW - 2 * 60_000, "processing");
  push(DEMO_NOW - 7 * 60_000, "processing");

  return payments
    .map((payment) =>
      payment.refundedAt && new Date(payment.refundedAt).getTime() > DEMO_NOW
        ? { ...payment, refundedAt: new Date(DEMO_NOW - 30 * 60_000).toISOString() }
        : payment,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const SEED_STATE: GatewayState = {
  links: LINKS,
  widgets: WIDGETS,
  payments: generatePayments(),
  settings: {
    businessName: "Lumen Studio",
    receiveAsset: "USDC",
    walletAddress: "lumen-studio.near",
    apiKeys: [
      { id: "key_1", label: "Production server", prefix: "gw_test_4f9a", createdAt: daysAgo(180) },
      { id: "key_2", label: "Staging", prefix: "gw_test_b21c", createdAt: daysAgo(42) },
    ],
    webhooks: [
      { id: "whk_1", url: "https://api.lumen.studio/hooks/gateway", events: ["payment.settled", "payment.refunded"], enabled: true, createdAt: daysAgo(170) },
      { id: "whk_2", url: "https://staging.lumen.studio/hooks/gateway", events: ["payment.processing", "payment.settled", "payment.refunded", "payment.expired"], enabled: false, createdAt: daysAgo(40) },
    ],
    team: [
      { id: "mem_1", name: "Studio owner", email: "owner@lumen.studio", role: "owner", status: "active", createdAt: daysAgo(728) },
      { id: "mem_2", name: "Finance lead", email: "finance@lumen.studio", role: "finance", status: "active", createdAt: daysAgo(400) },
      { id: "mem_3", name: "Support desk", email: "support@lumen.studio", role: "viewer", status: "invited", createdAt: daysAgo(3) },
    ],
    branding: { accent: "#00EC97", supportEmail: "support@lumen.studio", statementName: "LUMEN STUDIO" },
    notifications: { settled: true, processing: true, refunded: true, expired: true, links: true },
  },
  setupDismissed: false,
};

export const EMPTY_STATE: GatewayState = { ...SEED_STATE, links: [], widgets: [], payments: [], setupDismissed: false };
