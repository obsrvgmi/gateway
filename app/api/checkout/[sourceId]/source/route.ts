import { paymentsMode } from "@/server/env";
import { json, publicRoute } from "@/server/http/route";
import { limitCheckout } from "@/server/payments/checkout-http";
import { loadSource, publicSource } from "@/server/payments/source";

export const GET = publicRoute(async (request, { sourceId }) => {
  await limitCheckout(request, "source", 120);
  const source = await loadSource(sourceId);
  return json({ ...(await publicSource(source)), mode: paymentsMode() });
});
