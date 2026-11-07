import { z } from "zod";
import { json, orgRoute, readJson } from "@/server/http/route";
import { rateLimit } from "@/server/http/rate-limit";
import { prepareRefund } from "@/server/payments/refunds";

const body = z.object({
  paymentId: z.string().min(1).max(60),
  /** Smallest units of the asset received. Leave out to refund everything left. */
  amountBase: z.string().regex(/^[1-9]\d{0,77}$/).nullish(),
});

export const POST = orgRoute("money:write", async (request, { orgId, userId, ip }) => {
  await rateLimit(`refund:${orgId}`, 60, 3600);
  const input = await readJson(request, body);
  return json(await prepareRefund({ orgId, userId, ip, paymentId: input.paymentId, amountBase: input.amountBase }), { status: 201 });
});
