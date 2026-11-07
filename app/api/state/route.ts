import { json, userRoute } from "@/server/http/route";
import { loadState } from "@/server/state";

/** 409 means signed in but with no workspace yet; the dashboard sends them to onboarding. */
export const GET = userRoute(async (_request, { principal }) => {
  if (!principal.orgId || !principal.role) return json({ error: { code: "no_workspace", message: "Finish setting up your workspace." } }, { status: 409 });
  return json(await loadState(principal.orgId, { ...principal.user, role: principal.role }));
});
