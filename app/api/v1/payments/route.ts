import { and, desc, eq, lt, notInArray } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { apiRoute } from "@/server/http/api-key";
import { json } from "@/server/http/route";
import { paymentEventBody } from "@/server/payments/serialize";

/** Newest first. Pass the last `created_at` you saw as `before` for the next page. */
export const GET = apiRoute(async (request, { orgId }) => {
  const { searchParams } = request.nextUrl;
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);
  const before = searchParams.get("before");
  const beforeDate = before ? new Date(before) : null;
  const rows = await db()
    .select()
    .from(schema.payments)
    .where(and(eq(schema.payments.orgId, orgId), notInArray(schema.payments.state, ["quoting", "quote_failed", "awaiting_deposit"]), beforeDate && !Number.isNaN(beforeDate.getTime()) ? lt(schema.payments.createdAt, beforeDate) : undefined))
    .orderBy(desc(schema.payments.createdAt))
    .limit(limit);
  return json({ data: rows.map(paymentEventBody) });
});
