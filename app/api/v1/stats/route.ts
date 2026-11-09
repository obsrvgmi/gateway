import { z } from "zod";
import { apiRoute } from "@/server/http/api-key";
import { badRequest } from "@/server/http/errors";
import { json } from "@/server/http/route";
import { merchantStats } from "@/server/stats";

const query = z.object({
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
  link: z.string().regex(/^(lnk|wgt)_[a-z0-9]+$/, "link must be a link or widget id.").optional(),
});

/** Totals for the key's workspace, in the current mode. Optional window (`since`, `until`) and `link`. */
export const GET = apiRoute(async (request, { orgId }) => {
  const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid query.", "invalid_query");
  const { since, until, link } = parsed.data;
  return json(await merchantStats(orgId, { since: since ? new Date(since) : undefined, until: until ? new Date(until) : undefined, sourceId: link }));
});
