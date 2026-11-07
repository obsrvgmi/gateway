import { z } from "zod";
import { assertSameOrigin, json, publicRoute, readJson } from "@/server/http/route";
import { previewQuote } from "@/server/payments/checkout";
import { assertCountryAllowed, limitCheckout } from "@/server/payments/checkout-http";
import { loadSource } from "@/server/payments/source";
import { assetSymbol } from "@/server/schemas";

const body = z.object({ payAsset: assetSymbol, amount: z.number().positive().nullish() });

export const POST = publicRoute(async (request, { sourceId }) => {
  assertSameOrigin(request);
  assertCountryAllowed(request);
  await limitCheckout(request, "preview", 40);
  await limitCheckout(request, "preview", 40, sourceId);
  const input = await readJson(request, body);
  return json(await previewQuote(await loadSource(sourceId), input));
});
