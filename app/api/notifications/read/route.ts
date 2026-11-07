import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { json, orgRoute, readJson } from "@/server/http/route";

const body = z.object({ ids: z.array(z.string()).max(200).optional() });

/** Marks the given notifications read, or all of them. */
export const POST = orgRoute("read", async (request, { orgId }) => {
  const { ids } = await readJson(request, body);
  await db().update(schema.notifications).set({ readAt: new Date() }).where(and(eq(schema.notifications.orgId, orgId), isNull(schema.notifications.readAt), ids ? inArray(schema.notifications.id, ids) : undefined));
  return json({ ok: true });
});
