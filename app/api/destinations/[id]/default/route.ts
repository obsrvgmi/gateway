import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { notFound } from "@/server/http/errors";
import { json, orgRoute } from "@/server/http/route";

export const POST = orgRoute("money:write", async (_request, { orgId, params }) => {
  const [row] = await db().select({ id: schema.destinations.id }).from(schema.destinations).where(and(eq(schema.destinations.id, params.id), eq(schema.destinations.orgId, orgId), isNull(schema.destinations.removedAt))).limit(1);
  if (!row) throw notFound();
  await db().update(schema.organizations).set({ defaultDestinationId: row.id }).where(eq(schema.organizations.id, orgId));
  return json({ ok: true });
});
