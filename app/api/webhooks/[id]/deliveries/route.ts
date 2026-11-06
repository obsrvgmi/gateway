import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { json, orgRoute } from "@/server/http/route";

export const GET = orgRoute("read", async (_request, { orgId, params }) => {
  const rows = await db().select().from(schema.webhookDeliveries).where(and(eq(schema.webhookDeliveries.webhookId, params.id), eq(schema.webhookDeliveries.orgId, orgId))).orderBy(desc(schema.webhookDeliveries.createdAt)).limit(50);
  return json(rows.map((row) => ({ id: row.id, eventId: row.eventId, type: row.type, state: row.state, attempts: row.attempts, lastStatus: row.lastStatus, lastError: row.lastError, createdAt: row.createdAt.toISOString(), deliveredAt: row.deliveredAt?.toISOString() ?? null })));
});
