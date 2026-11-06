import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { db, schema } from "@/server/db";
import { notFound } from "@/server/http/errors";
import { json, orgRoute, readJson } from "@/server/http/route";

const patch = z.object({ enabled: z.boolean() });

export const PATCH = orgRoute("developers:write", async (request, { orgId, params }) => {
  const { enabled } = await readJson(request, patch);
  const [row] = await db().update(schema.webhooks).set({ enabled }).where(and(eq(schema.webhooks.id, params.id), eq(schema.webhooks.orgId, orgId), isNull(schema.webhooks.deletedAt))).returning({ id: schema.webhooks.id });
  if (!row) throw notFound();
  return json({ ok: true });
});

export const DELETE = orgRoute("developers:write", async (_request, { orgId, userId, ip, params }) => {
  const [row] = await db().update(schema.webhooks).set({ deletedAt: new Date(), enabled: false }).where(and(eq(schema.webhooks.id, params.id), eq(schema.webhooks.orgId, orgId))).returning({ url: schema.webhooks.url });
  if (!row) throw notFound();
  await audit(db(), { orgId, actorType: "user", actorId: userId, action: "webhook.deleted", target: row.url, ip });
  return json({ ok: true });
});
