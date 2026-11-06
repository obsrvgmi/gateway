import { json, orgRoute, readJson } from "@/server/http/route";
import { deleteWidget, updateWidget } from "@/server/resources";
import { widgetPatch } from "@/server/schemas";

export const PATCH = orgRoute("widgets:write", async (request, { orgId, userId, ip, params }) => {
  const patch = await readJson(request, widgetPatch);
  return json(await updateWidget(params.id, patch, { orgId, actorType: "user", actorId: userId, ip }));
});

export const DELETE = orgRoute("widgets:write", async (_request, { orgId, userId, ip, params }) => {
  await deleteWidget(params.id, { orgId, actorType: "user", actorId: userId, ip });
  return json({ ok: true });
});
