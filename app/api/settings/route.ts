import { eq } from "drizzle-orm";
import { z } from "zod";
import { can } from "@/server/auth/rbac";
import { audit } from "@/server/audit";
import { db, schema } from "@/server/db";
import { forbidden } from "@/server/http/errors";
import { json, orgRoute, readJson } from "@/server/http/route";
import { settingsPatch } from "@/server/schemas";
import { loadOrgRow } from "@/server/state";

const body = settingsPatch.extend({
  settlementMode: z.enum(["balance", "direct"]).optional(),
  defaultDestinationId: z.string().optional(),
});

/** Finance can set payout rules, which only decide when a merchant is prompted. Settlement mode is owner-only. */
export const PATCH = orgRoute("read", async (request, { orgId, userId, role, ip }) => {
  const patch = await readJson(request, body);
  const touchesBusiness = patch.businessName !== undefined || patch.receiveAsset !== undefined || patch.branding !== undefined || patch.notifications !== undefined || patch.setupDismissed !== undefined;
  if (touchesBusiness && !can(role, "settings:write")) throw forbidden();
  if ((patch.payouts !== undefined || patch.defaultDestinationId !== undefined) && !can(role, "money:write") && !can(role, "settings:write")) throw forbidden();
  if (patch.settlementMode !== undefined && !can(role, "wallet:write")) throw forbidden("Only an owner can change how funds settle.");

  const values: Partial<typeof schema.organizations.$inferInsert> = {};
  if (patch.businessName !== undefined) values.businessName = patch.businessName;
  if (patch.receiveAsset !== undefined) values.receiveAsset = patch.receiveAsset;
  if (patch.branding !== undefined) values.branding = patch.branding;
  if (patch.notifications !== undefined) values.notifications = patch.notifications;
  if (patch.setupDismissed !== undefined) values.setupDismissed = patch.setupDismissed;
  if (patch.settlementMode !== undefined) values.settlementMode = patch.settlementMode;
  if (patch.payouts?.schedule !== undefined) values.payoutSchedule = patch.payouts.schedule;
  if (patch.payouts?.holdDays !== undefined) values.holdDays = patch.payouts.holdDays;
  if (patch.payouts?.minimumUsd !== undefined) values.minimumUsd = patch.payouts.minimumUsd.toFixed(2);
  if (patch.defaultDestinationId !== undefined) values.defaultDestinationId = patch.defaultDestinationId;
  if (Object.keys(values).length) await db().update(schema.organizations).set(values).where(eq(schema.organizations.id, orgId));
  await audit(db(), { orgId, actorType: "user", actorId: userId, action: "settings.updated", detail: { fields: Object.keys(values) }, ip });
  return json({ ok: true, settlementMode: (await loadOrgRow(orgId)).settlementMode });
});
