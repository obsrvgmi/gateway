import { assertSameOrigin, clientIp, json, publicRoute, readJson } from "@/server/http/route";
import { assetSymbol } from "@/server/schemas";
import { createSession, createSessionBody } from "@/server/payments/checkout";
import { assertCountryAllowed, limitCheckout } from "@/server/payments/checkout-http";
import { loadSource } from "@/server/payments/source";

const body = createSessionBody.extend({ payAsset: assetSymbol });

export const POST = publicRoute(async (request, { sourceId }) => {
  assertSameOrigin(request);
  assertCountryAllowed(request);
  await limitCheckout(request, "session", 10);
  const input = await readJson(request, body);
  // After parsing, so junk can't use up a merchant's allowance and turn their real customers away.
  await limitCheckout(request, "session", 10, sourceId);
  const source = await loadSource(sourceId);
  return json(await createSession(source, { ...input, ip: clientIp(request) }), { status: 201 });
});
