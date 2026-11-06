import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { db, schema } from "@/server/db";
import { conflict, notFound } from "@/server/http/errors";
import { json, orgRoute, readJson } from "@/server/http/route";
import { teamRole } from "@/server/schemas";

const body = z.object({ role: teamRole });

/** Nobody can be made an owner here, and an owner can't be changed or removed, so a workspace always keeps one. */
async function assertChangeable(orgId: string, userId: string) {
  const [member] = await db().select({ role: schema.memberships.role }).from(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, userId))).limit(1);
  if (!member) throw notFound();
  if (member.role === "owner") throw conflict("The workspace owner can't be changed here.");
}

export const PATCH = orgRoute("team:write", async (request, { orgId, userId, ip, params }) => {
  const { role } = await readJson(request, body);
  await assertChangeable(orgId, params.id);
  await db().update(schema.memberships).set({ role }).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, params.id)));
  await audit(db(), { orgId, actorType: "user", actorId: userId, action: "team.role_changed", target: params.id, detail: { role }, ip });
  return json({ ok: true });
});

export const DELETE = orgRoute("team:write", async (_request, { orgId, userId, ip, params }) => {
  await assertChangeable(orgId, params.id);
  await db().delete(schema.memberships).where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, params.id)));
  await audit(db(), { orgId, actorType: "user", actorId: userId, action: "team.removed", target: params.id, ip });
  return json({ ok: true });
});
