import { z } from "zod";
import { audit } from "@/server/audit";
import { db, schema } from "@/server/db";
import { paymentsMode } from "@/server/env";
import { json, orgRoute, readJson } from "@/server/http/route";
import { hashSecret, newId, newSecret } from "@/server/ids";

const body = z.object({ label: z.string().trim().max(80).default("") });

/** The full key is shown once, here, and only its hash is kept. */
export const POST = orgRoute("developers:write", async (request, { orgId, userId, ip }) => {
  const { label } = await readJson(request, body);
  const secret = `gw_${paymentsMode() === "live" ? "live" : "test"}_${newSecret()}`;
  const prefix = secret.slice(0, 14);
  const id = newId("key_");
  const [row] = await db().insert(schema.apiKeys).values({ id, orgId, label: label || "Untitled key", prefix, keyHash: hashSecret(secret), createdBy: userId }).returning();
  await audit(db(), { orgId, actorType: "user", actorId: userId, action: "api_key.created", target: id, detail: { prefix }, ip });
  return json({ id, label: row.label, prefix, createdAt: row.createdAt.toISOString(), secret }, { status: 201 });
});
