import { json, publicRoute } from "@/server/http/route";
import { loadSession, publicSession } from "@/server/payments/checkout";
import { limitCheckout } from "@/server/payments/checkout-http";

/** The id is unguessable and known only to the customer who created it. */
export const GET = publicRoute(async (request, { id }) => {
  await limitCheckout(request, "status", 120);
  return json(publicSession(await loadSession(id)));
});
