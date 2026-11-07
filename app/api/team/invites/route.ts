import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { db, schema } from "@/server/db";
import { sendEmail } from "@/server/email";
import { env } from "@/server/env";
import { conflict, forbidden } from "@/server/http/errors";
import { json, orgRoute, readJson } from "@/server/http/route";
import { rateLimit } from "@/server/http/rate-limit";
import { hashSecret, newId, newSecret } from "@/server/ids";
import { log } from "@/server/log";
import { email, teamRole } from "@/server/schemas";
import { loadOrgRow } from "@/server/state";

const INVITE_DAYS = 7;
const body = z.object({ email, role: teamRole });

export const POST = orgRoute("team:write", async (request, { orgId, userId, role, ip }) => {
  await rateLimit(`invite:${orgId}`, 30, 3600);
  const input = await readJson(request, body);
  if (input.role === "finance" && role !== "owner") throw forbidden("Only an owner can give someone access to money.");
  const [member] = await db().select({ id: schema.users.id }).from(schema.memberships).innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId)).where(and(eq(schema.memberships.orgId, orgId), eq(schema.users.email, input.email))).limit(1);
  if (member) throw conflict("This person is already on the team.");
  const token = newSecret();
  const id = newId("inv_");
  await db().update(schema.invites).set({ revokedAt: new Date() }).where(and(eq(schema.invites.orgId, orgId), eq(schema.invites.email, input.email), isNull(schema.invites.acceptedAt)));
  await db().insert(schema.invites).values({ id, orgId, email: input.email, role: input.role, tokenHash: hashSecret(token), invitedBy: userId, expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) });
  await audit(db(), { orgId, actorType: "user", actorId: userId, action: "team.invited", target: input.email, detail: { role: input.role }, ip });
  const org = await loadOrgRow(orgId);
  await sendEmail({ to: input.email, subject: `Join ${org.businessName} on Gateway`, text: `You've been invited to help run ${org.businessName} on Gateway.\n\nAccept: ${env().APP_URL}/invite/${encodeURIComponent(token)}\n\nThis invitation expires in ${INVITE_DAYS} days.` }).catch((error) => log("error", "invite email failed", { error }));
  return json({ id, name: "Invited teammate", email: input.email, role: input.role, status: "invited", createdAt: new Date().toISOString() }, { status: 201 });
});
