import { badRequest } from "@/server/http/errors";
import { json, orgRoute } from "@/server/http/route";
import { loadChanges } from "@/server/state";

export const GET = orgRoute("read", async (request, { orgId }) => {
  const since = new Date(request.nextUrl.searchParams.get("since") ?? "");
  if (Number.isNaN(since.getTime())) throw badRequest("`since` must be a date.");
  return json(await loadChanges(orgId, since));
});
