import { randomBytes } from "node:crypto";
import { audit } from "@/server/audit";
import { encrypt } from "@/server/crypto";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";
import { badRequest } from "@/server/http/errors";
import { json, orgRoute, readJson } from "@/server/http/route";
import { newId } from "@/server/ids";
import { webhookCreate } from "@/server/schemas";
import { assertWebhookUrl } from "@/server/webhooks/deliver";

/** The signing secret is shown once, here. It's stored encrypted because the worker needs it to sign. */
export const POST = orgRoute("developers:write", async (request, { orgId, userId, ip }) => {
  const input = await readJson(request, webhookCreate);
  try {
    assertWebhookUrl(input.url);
  } catch (error) {
    throw badRequest((error as Error).message, "webhook_url_invalid");
  }
  const secret = `whsec_${randomBytes(24).toString("base64url")}`;
  const id = newId("whk_");
  const [row] = await db().insert(schema.webhooks).values({ id, orgId, url: input.url, events: input.events, secretEnc: encrypt(secret, env().SECRET_KEY) }).returning();
  await audit(db(), { orgId, actorType: "user", actorId: userId, action: "webhook.created", target: input.url, ip });
  return json({ id, url: row.url, events: row.events, enabled: row.enabled, createdAt: row.createdAt.toISOString(), secret }, { status: 201 });
});
