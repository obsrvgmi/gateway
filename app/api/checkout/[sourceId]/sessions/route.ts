import { assertSameOrigin, clientIp, json, publicRoute, readJson } from "@/server/http/route";
import { assetSymbol } from "@/server/schemas";
import { createSession, createSessionBody } from "@/server/payments/checkout";
import { assertCountryAllowed, limitCheckout } from "@/server/payments/checkout-http";
import { loadSource } from "@/server/payments/source";

const body = createSessionBody.extend({ payAsset: assetSymbol });

export const POST = publicRoute(async (request, { sourceId }) => {
  assertSameOrigin(request);
  assertCountryAllowed(request);
  await limitCheckout(request, "session", 10, sourceId);
  const input = await readJson(request, body);
  const source = await loadSource(sourceId);
  return json(await createSession(source, { ...input, ip: clientIp(request) }), { status: 201 });
});
