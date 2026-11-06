import { and, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { apiRoute } from "@/server/http/api-key";
import { notFound } from "@/server/http/errors";
import { json } from "@/server/http/route";
import { paymentEventBody } from "@/server/payments/serialize";

export const GET = apiRoute(async (_request, { orgId, params }) => {
  const [row] = await db().select().from(schema.payments).where(and(eq(schema.payments.id, params.id), eq(schema.payments.orgId, orgId))).limit(1);
  if (!row) throw notFound();
  return json(paymentEventBody(row));
});
