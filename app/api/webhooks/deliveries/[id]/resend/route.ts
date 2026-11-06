import { and, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { notFound } from "@/server/http/errors";
import { json, orgRoute } from "@/server/http/route";

export const POST = orgRoute("developers:write", async (_request, { orgId, params }) => {
  const [row] = await db().update(schema.webhookDeliveries).set({ state: "pending", attempts: 0, nextAttemptAt: new Date(), lastError: null }).where(and(eq(schema.webhookDeliveries.id, params.id), eq(schema.webhookDeliveries.orgId, orgId))).returning({ id: schema.webhookDeliveries.id });
  if (!row) throw notFound();
  return json({ ok: true });
});
