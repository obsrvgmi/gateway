import { eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { db, schema } from "@/server/db";
import { conflict } from "@/server/http/errors";
import { json, readJson, userRoute } from "@/server/http/route";
import { newId } from "@/server/ids";
import { receiveSymbol } from "@/server/schemas";
import { TERMS_VERSION } from "@/lib/site";

const body = z.object({
  name: z.string().trim().max(120).default(""),
  businessName: z.string().trim().min(1, "Enter your business name.").max(120),
  receiveAsset: receiveSymbol,
  /** The merchant accepts responsibility for their own KYC, AML, licences and audits. */
  acceptTerms: z.literal(true, { error: "Accept the Merchant Terms to continue." }),
});

export const POST = userRoute(async (request, { principal, ip }) => {
  if (principal.orgId) throw conflict("This account already has a workspace.");
  const input = await readJson(request, body);
  const orgId = newId("org_");
  await db().transaction(async (tx) => {
    await tx.insert(schema.organizations).values({
      id: orgId,
      businessName: input.businessName,
      receiveAsset: input.receiveAsset,
      branding: { accent: "#00EC97", supportEmail: "", statementName: input.businessName.slice(0, 60) },
      notifications: { settled: true, processing: false, refunded: true, expired: false, links: true },
      termsVersion: TERMS_VERSION,
      termsAcceptedAt: new Date(),
      termsAcceptedBy: principal.user.id,
    });
    await tx.insert(schema.memberships).values({ orgId, userId: principal.user.id, role: "owner" });
    if (input.name) await tx.update(schema.users).set({ name: input.name }).where(eq(schema.users.id, principal.user.id));
    await tx.update(schema.sessions).set({ orgId }).where(eq(schema.sessions.tokenHash, principal.tokenHash));
    await audit(tx, { orgId, actorType: "user", actorId: principal.user.id, action: "org.created", target: orgId, detail: { termsVersion: TERMS_VERSION }, ip });
  });
  return json({ ok: true, orgId }, { status: 201 });
});
