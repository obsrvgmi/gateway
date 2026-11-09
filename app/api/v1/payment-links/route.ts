import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { env } from "@/server/env";
import { apiRoute, idempotentApiRoute } from "@/server/http/api-key";
import { json } from "@/server/http/route";
import { createLink } from "@/server/resources";
import { linkFields } from "@/server/schemas";
import { toLink } from "@/server/state";

/** From APP_URL, not the request: behind a proxy the request can carry an internal host. */
const withUrl = (_request: Request, link: ReturnType<typeof toLink>) => ({ ...link, url: `${new URL(env().APP_URL).origin}/pay/${link.id}` });

export const GET = apiRoute(async (request, { orgId }) => {
  const rows = await db().select().from(schema.paymentLinks).where(and(eq(schema.paymentLinks.orgId, orgId), isNull(schema.paymentLinks.deletedAt))).orderBy(desc(schema.paymentLinks.createdAt)).limit(200);
  return json({ data: rows.map((row) => withUrl(request, toLink(row))) });
});

export const POST = idempotentApiRoute(async (request, { orgId, keyId }, body) => {
  const link = await createLink(linkFields.parse(body), { orgId, actorType: "api_key", actorId: keyId });
  return { status: 201, body: withUrl(request, link) };
});
