import { z } from "zod";
import { json, orgRoute, readJson } from "@/server/http/route";
import { addDestination } from "@/server/payments/wallet";
import { clientId } from "@/server/schemas";

const body = z.object({
  id: clientId("dst_").optional(),
  label: z.string().trim().min(1).max(80).default("Wallet"),
  address: z.string().trim().min(1).max(200),
  message: z.string().max(1000).nullish(),
  signature: z.string().max(300).nullish(),
});

export const POST = orgRoute("money:write", async (request, { orgId, userId, ip }) => {
  const input = await readJson(request, body);
  const row = await addDestination({ orgId, userId, ip, ...input });
  return json({ id: row.id, label: row.label, address: row.address }, { status: 201 });
});
