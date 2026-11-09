import type { NextRequest } from "next/server";
import { notFound } from "@/server/http/errors";
import { json, publicRoute } from "@/server/http/route";
import { limitCheckout } from "@/server/payments/checkout-http";
import { loadSource } from "@/server/payments/source";
import { publicTotals } from "@/server/stats";

/**
 * A counter for the merchant's own site, such as "$4,210 raised from 37 payments". Off unless the merchant
 * turned on public totals for this link or widget, and then only the settled total and count: no
 * payers, amounts per payment, metadata or anything else.
 */
const handler = publicRoute(async (request, { sourceId }) => {
  await limitCheckout(request, "stats", 120);
  const source = await loadSource(sourceId);
  const enabled = source.kind === "link" ? source.link.publicStats : source.widget.publicStats;
  // The same answer as a missing source, so totals that are off reveal nothing, not even that they exist.
  if (!enabled) throw notFound("This payment page isn't available.");
  // Not cached: a counter should move the moment a payment settles. The per-IP limit bounds the cost.
  return json(await publicTotals(source.org.id, source.id));
});

/** Read from any site, errors included, so a page sees a 404 rather than a CORS failure. */
export async function GET(request: NextRequest, context: { params: Promise<{ sourceId: string }> }) {
  const response = await handler(request, context);
  response.headers.set("Access-Control-Allow-Origin", "*");
  return response;
}
