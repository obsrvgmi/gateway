import { and, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { notFound } from "@/server/http/errors";
import { json, orgRoute } from "@/server/http/route";

export const DELETE = orgRoute("team:write", async (_request, { orgId, params }) => {
  const [row] = await db().update(schema.invites).set({ revokedAt: new Date() }).where(and(eq(schema.invites.id, params.id), eq(schema.invites.orgId, orgId))).returning({ id: schema.invites.id });
  if (!row) throw notFound();
  return json({ ok: true });
});
