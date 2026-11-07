import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { db, schema } from "@/server/db";
import { forbidden, notFound } from "@/server/http/errors";
import { json, readJson, userRoute } from "@/server/http/route";
import { hashSecret } from "@/server/ids";

const body = z.object({ token: z.string().min(16).max(200) });

/** An invitation works only for the email it was sent to, so a forwarded link grants nothing. */
export const POST = userRoute(async (request, { principal, ip }) => {
  const { token } = await readJson(request, body);
  const orgId = await db().transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(schema.invites)
      .where(and(eq(schema.invites.tokenHash, hashSecret(token)), isNull(schema.invites.acceptedAt), isNull(schema.invites.revokedAt), gt(schema.invites.expiresAt, new Date())))
      .for("update")
      .limit(1);
    if (!invite) throw notFound("This invitation has expired or was already used.");
    if (invite.email !== principal.user.email) throw forbidden(`This invitation was sent to ${invite.email}. Sign in with that address.`);
    await tx.update(schema.invites).set({ acceptedAt: new Date() }).where(eq(schema.invites.id, invite.id));
    await tx.insert(schema.memberships).values({ orgId: invite.orgId, userId: principal.user.id, role: invite.role }).onConflictDoNothing();
    await tx.update(schema.sessions).set({ orgId: invite.orgId }).where(eq(schema.sessions.tokenHash, principal.tokenHash));
    await audit(tx, { orgId: invite.orgId, actorType: "user", actorId: principal.user.id, action: "team.joined", detail: { role: invite.role }, ip });
    return invite.orgId;
  });
  return json({ ok: true, orgId });
});
