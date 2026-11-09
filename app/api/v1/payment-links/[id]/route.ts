import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";
import { apiRoute } from "@/server/http/api-key";
import { notFound } from "@/server/http/errors";
import { json, readJson } from "@/server/http/route";
import { deleteLink, updateLink } from "@/server/resources";
import { linkPatch } from "@/server/schemas";
import { toLink } from "@/server/state";

export const GET = apiRoute(async (_request, { orgId, params }) => {
  const [row] = await db().select().from(schema.paymentLinks).where(and(eq(schema.paymentLinks.id, params.id), eq(schema.paymentLinks.orgId, orgId), isNull(schema.paymentLinks.deletedAt))).limit(1);
  if (!row) throw notFound();
  return json({ ...toLink(row), url: `${new URL(env().APP_URL).origin}/pay/${row.id}` });
});

export const PATCH = apiRoute(async (request, { orgId, keyId, params }) => {
  return json(await updateLink(params.id, await readJson(request, linkPatch), { orgId, actorType: "api_key", actorId: keyId }));
});

export const DELETE = apiRoute(async (_request, { orgId, keyId, params }) => {
  await deleteLink(params.id, { orgId, actorType: "api_key", actorId: keyId });
  return json({ ok: true });
});
