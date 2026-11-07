import { z } from "zod";
import { json, orgRoute, readJson } from "@/server/http/route";
import { rateLimit } from "@/server/http/rate-limit";
import { preparePayout } from "@/server/payments/payouts";
import { assetSymbol } from "@/server/schemas";

const body = z.object({
  asset: assetSymbol,
  /** Smallest units, as a string, so nothing is rounded on the way here. */
  amountBase: z.string().regex(/^[1-9]\d{0,77}$/, "Enter an amount above zero."),
  receiveAsset: assetSymbol,
  destinationId: z.string().min(1).max(60),
});

export const POST = orgRoute("money:write", async (request, { orgId, userId, ip }) => {
  await rateLimit(`payout:${orgId}`, 30, 3600);
  const input = await readJson(request, body);
  return json(await preparePayout({ orgId, userId, ip, asset: input.asset, amountBase: BigInt(input.amountBase), receiveAsset: input.receiveAsset, destinationId: input.destinationId }), { status: 201 });
});
