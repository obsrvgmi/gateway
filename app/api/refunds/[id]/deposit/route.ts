import { z } from "zod";
import { json, orgRoute, readJson } from "@/server/http/route";
import { recordRefundDeposit } from "@/server/payments/refunds";

const body = z.object({ txHash: z.string().trim().min(10).max(200) });

/** A note that the merchant sent it. The refund still moves only when the provider reports it. */
export const POST = orgRoute("money:write", async (request, { orgId, params }) => {
  const { txHash } = await readJson(request, body);
  await recordRefundDeposit({ orgId, refundId: params.id, txHash });
  return json({ ok: true });
});
