import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { json, orgRoute } from "@/server/http/route";

export const GET = orgRoute("settings:write", async (_request, { orgId }) => {
  const rows = await db().select().from(schema.auditLog).where(eq(schema.auditLog.orgId, orgId)).orderBy(desc(schema.auditLog.createdAt)).limit(200);
  return json(rows.map((row) => ({ id: row.id, actor: row.actorType, action: row.action, target: row.target, at: row.createdAt.toISOString() })));
});
