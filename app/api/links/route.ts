import { json, orgRoute, readJson } from "@/server/http/route";
import { createLink } from "@/server/resources";
import { linkCreate } from "@/server/schemas";

export const POST = orgRoute("links:write", async (request, { orgId, userId, ip }) => {
  const input = await readJson(request, linkCreate);
  return json(await createLink(input, { orgId, actorType: "user", actorId: userId, ip }), { status: 201 });
});
