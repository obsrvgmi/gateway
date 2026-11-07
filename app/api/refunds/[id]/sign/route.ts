import { z } from "zod";
import { json, orgRoute, readJson } from "@/server/http/route";
import { submitRefund } from "@/server/payments/refunds";

const body = z.object({ signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/, "That signature isn't valid.") });

export const POST = orgRoute("money:write", async (request, { orgId, userId, ip, params }) => {
  const { signature } = await readJson(request, body);
  const row = await submitRefund({ orgId, refundId: params.id, signature, userId, ip });
  return json({ id: row.id, state: row.state, failureReason: row.failureReason });
});
