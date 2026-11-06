import { json, orgRoute, readJson } from "@/server/http/route";
import { createWidget } from "@/server/resources";
import { widgetCreate } from "@/server/schemas";

export const POST = orgRoute("widgets:write", async (request, { orgId, userId, ip }) => {
  const input = await readJson(request, widgetCreate);
  return json(await createWidget(input, { orgId, actorType: "user", actorId: userId, ip }), { status: 201 });
});
