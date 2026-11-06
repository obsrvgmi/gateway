import { z } from "zod";
import { json, orgRoute, readJson } from "@/server/http/route";
import { setSettlementWallet } from "@/server/payments/wallet";

const body = z.object({
  wallet: z.string().trim().min(1).max(100),
  message: z.string().min(1).max(1000),
  newSignature: z.string().min(1).max(300),
  currentSignature: z.string().min(1).max(300).nullish(),
});

export const POST = orgRoute("wallet:write", async (request, { orgId, userId, ip }) => {
  const input = await readJson(request, body);
  const org = await setSettlementWallet({ orgId, userId, ip, ...input });
  return json({ ok: true, wallet: org.walletAddress });
});
