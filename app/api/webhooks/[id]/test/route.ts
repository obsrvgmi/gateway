import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { notFound } from "@/server/http/errors";
import { json, orgRoute } from "@/server/http/route";
import { newId } from "@/server/ids";

/** Queues a signed `ping`, so a merchant can check their endpoint without a real payment. */
export const POST = orgRoute("developers:write", async (_request, { orgId, params }) => {
  const [hook] = await db().select({ id: schema.webhooks.id }).from(schema.webhooks).where(and(eq(schema.webhooks.id, params.id), eq(schema.webhooks.orgId, orgId), isNull(schema.webhooks.deletedAt))).limit(1);
  if (!hook) throw notFound();
  const eventId = newId("evt_test_");
  const id = newId("whd_");
  const body = JSON.stringify({ id: eventId, type: "ping", created_at: new Date().toISOString(), data: {} });
  await db().insert(schema.webhookDeliveries).values({ id, webhookId: hook.id, orgId, eventId, type: "ping", body, nextAttemptAt: new Date() });
  return json({ ok: true, deliveryId: id });
});
