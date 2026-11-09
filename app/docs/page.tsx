import type { Metadata } from "next";
import { ASSETS, RECEIVE_ASSETS } from "@/lib/assets";
import { DocsPage, type AssetRow } from "@/components/docs/docs-page";
import type { StateRow } from "@/components/docs/interactives";
import { ROUTE_MINIMUMS_USD, UNVERIFIABLE_CHAINS } from "@/server/payments/guards";
import { dashboardStatus, PAYMENT_STATES, webhookEventFor, type PaymentState } from "@/server/payments/state-machine";

export const metadata: Metadata = {
  title: "Developer docs",
  description: "Take crypto payments in your app with hosted checkout, a popup, or an embedded widget, a REST API, and signed webhooks.",
};

/**
 * The sandbox and live sites are separate deployments, and both serve these docs, so each names both.
 * Set `DOCS_SANDBOX_URL` and `DOCS_LIVE_URL` when either moves to its own domain.
 */
const SANDBOX_URL = process.env.DOCS_SANDBOX_URL ?? "https://web-production-5e73d0.up.railway.app";
const LIVE_URL = process.env.DOCS_LIVE_URL ?? "https://web-production-0cb6e.up.railway.app";

/** What each state means to a merchant. Every state must have a line, so a new one can't go undocumented. */
const MEANING: Record<PaymentState, string> = {
  quoting: "Checkout is asking the route for a price and an address. Not a payment yet, so the API doesn't list it.",
  quote_failed: "No address could be issued, so nothing could be paid. Not listed by the API.",
  awaiting_deposit: "An address was issued and is waiting for the customer. Not a payment until money arrives.",
  deposit_seen: "The customer's coins reached the address.",
  incomplete_deposit: "Less than the quote's minimum arrived. The route returns it to the customer.",
  processing: "The route is converting the coins and sending them to you.",
  settled: "You have the money. Fulfil the order.",
  underpaid: "The route completed, but less than quoted reached you. You keep what arrived.",
  provider_refunded: "The route couldn't complete and returned the deposit to the customer's wallet.",
  failed: "The route failed. Nothing reached you.",
  expired: "Nothing arrived before the deadline. Not final: money that arrives late can still settle.",
  refund_pending: "You started a refund. It still counts as settled until the refund completes.",
  refunded: "You refunded the customer.",
};

const assets: AssetRow[] = Object.values(ASSETS).map((asset) => ({
  symbol: asset.symbol,
  name: asset.name,
  chain: asset.chain,
  receivable: RECEIVE_ASSETS.some((receive) => receive.symbol === asset.symbol),
  minimumUsd: ROUTE_MINIMUMS_USD[asset.blockchain] ?? 0,
  closedLive: UNVERIFIABLE_CHAINS.has(asset.blockchain),
}));

const states: StateRow[] = PAYMENT_STATES.map((state) => ({ state, status: dashboardStatus(state), event: webhookEventFor(state), meaning: MEANING[state] }));

export default function Docs() {
  return <DocsPage sandboxUrl={SANDBOX_URL} liveUrl={LIVE_URL} assets={assets} states={states} limits={{ minUsd: Number(process.env.MIN_PAYMENT_USD ?? 1), maxUsd: Number(process.env.MAX_PAYMENT_USD ?? 1_000_000) }} />;
}
