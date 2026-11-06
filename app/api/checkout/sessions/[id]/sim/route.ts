import { z } from "zod";
import { notFound } from "@/server/http/errors";
import { assertSameOrigin, json, publicRoute, readJson } from "@/server/http/route";
import { loadSession } from "@/server/payments/checkout";
import { limitCheckout } from "@/server/payments/checkout-http";
import { provider } from "@/server/payments/provider";
import { SimProvider } from "@/server/payments/provider/sim";

const body = z.object({ scenario: z.enum(["pay", "underpay", "fail"]).default("pay") });

/** Test mode's "send the money" button. In live mode this route doesn't exist. */
export const POST = publicRoute(async (request, { id }) => {
  assertSameOrigin(request);
  const active = provider();
  if (!(active instanceof SimProvider)) throw notFound();
  await limitCheckout(request, "sim", 30);
  const { scenario } = await readJson(request, body);
  const row = await loadSession(id);
  if (!row.depositAddress || row.live) throw notFound();
  await active.simulateDeposit(row.depositAddress, scenario);
  return json({ ok: true });
});
