import { json, publicRoute } from "@/server/http/route";
import { loadSession, publicSession } from "@/server/payments/checkout";
import { assertSessionToken, limitCheckout } from "@/server/payments/checkout-http";
import { closedByAnotherPayment } from "@/server/payments/source";

/**
 * The customer's own session, opened by the token only their browser holds (`x-session-token`). The
 * `pay_` id alone opens nothing, because it also goes to the merchant's webhooks and success URL.
 */
export const GET = publicRoute(async (request, { id }) => {
  await limitCheckout(request, "status", 120);
  assertSessionToken(request, id);
  const row = await loadSession(id);
  return json({ ...publicSession(row), closedByAnotherPayment: await closedByAnotherPayment(row) });
});
