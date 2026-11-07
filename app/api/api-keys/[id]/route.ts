import { and, eq, isNull } from "drizzle-orm";
import { audit } from "@/server/audit";
import { db, schema } from "@/server/db";
import { notFound } from "@/server/http/errors";
import { json, orgRoute } from "@/server/http/route";

export const DELETE = orgRoute("developers:write", async (_request, { orgId, userId, ip, params }) => {
  const [row] = await db().update(schema.apiKeys).set({ revokedAt: new Date() }).where(and(eq(schema.apiKeys.id, params.id), eq(schema.apiKeys.orgId, orgId), isNull(schema.apiKeys.revokedAt))).returning({ id: schema.apiKeys.id });
  if (!row) throw notFound();
  await audit(db(), { orgId, actorType: "user", actorId: userId, action: "api_key.revoked", target: params.id, ip });
  return json({ ok: true });
});
