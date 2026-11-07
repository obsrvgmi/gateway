import { z } from "zod";
import { forbidden } from "@/server/http/errors";
import { can } from "@/server/auth/rbac";
import { json, orgRoute, readJson } from "@/server/http/route";
import { issueChallenge, parseEvmWallet } from "@/server/payments/wallet";

const body = z.object({ action: z.enum(["settlement", "destination"]), address: z.string().trim().min(1).max(200) });

export const POST = orgRoute("read", async (request, { orgId, role }) => {
  const input = await readJson(request, body);
  if (input.action === "settlement" && !can(role, "wallet:write")) throw forbidden("Only an owner can change the settlement wallet.");
  if (input.action === "destination" && !can(role, "money:write")) throw forbidden();
  const address = input.action === "settlement" ? parseEvmWallet(input.address) : input.address;
  return json({ message: issueChallenge(input.action, orgId, address), address });
});
