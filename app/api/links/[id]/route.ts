import { json, orgRoute, readJson } from "@/server/http/route";
import { deleteLink, updateLink } from "@/server/resources";
import { linkPatch } from "@/server/schemas";

export const PATCH = orgRoute("links:write", async (request, { orgId, userId, ip, params }) => {
  const patch = await readJson(request, linkPatch);
  return json(await updateLink(params.id, patch, { orgId, actorType: "user", actorId: userId, ip }));
});

export const DELETE = orgRoute("links:write", async (_request, { orgId, userId, ip, params }) => {
  await deleteLink(params.id, { orgId, actorType: "user", actorId: userId, ip });
  return json({ ok: true });
});
