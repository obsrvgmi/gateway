import { and, eq, isNull } from "drizzle-orm";
import { audit } from "@/server/audit";
import { db, schema } from "@/server/db";
import { conflict, notFound } from "@/server/http/errors";
import { json, orgRoute } from "@/server/http/route";
import { loadOrgRow } from "@/server/state";

export const DELETE = orgRoute("money:write", async (_request, { orgId, userId, ip, params }) => {
  const org = await loadOrgRow(orgId);
  if (org.defaultDestinationId === params.id) throw conflict("Choose another default destination first.");
  const [row] = await db().update(schema.destinations).set({ removedAt: new Date() }).where(and(eq(schema.destinations.id, params.id), eq(schema.destinations.orgId, orgId), isNull(schema.destinations.removedAt))).returning({ address: schema.destinations.address });
  if (!row) throw notFound();
  await audit(db(), { orgId, actorType: "user", actorId: userId, action: "destination.removed", target: row.address, ip });
  return json({ ok: true });
});
