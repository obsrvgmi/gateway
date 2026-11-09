import { and, desc, eq, inArray, lt, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { apiRoute } from "@/server/http/api-key";
import { badRequest } from "@/server/http/errors";
import { json } from "@/server/http/route";
import { dashboardStatus, PAYMENT_STATES, UNPAID_STATES } from "@/server/payments/state-machine";
import { paymentEventBody } from "@/server/payments/serialize";

/** New parameters are strict. `limit` and `before` keep their original forgiving reading, so older calls still work. */
const query = z.object({
  limit: z.preprocess((value) => {
    const number = Math.floor(Number(value));
    return Number.isFinite(number) && number >= 1 ? Math.min(number, 200) : 50;
  }, z.number()),
  starting_after: z.string().regex(/^pay_[a-z0-9]+$/, "starting_after must be a payment id.").optional(),
  before: z.preprocess((value) => {
    const date = typeof value === "string" && value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : undefined;
  }, z.date().optional()),
  link: z.string().regex(/^(lnk|wgt)_[a-z0-9]+$/, "link must be a link or widget id.").optional(),
  status: z.enum(["processing", "settled", "refunded", "expired", "failed"]).optional(),
});

/**
 * Newest first. When `has_more` is true, pass the last payment's id as `starting_after` for the next
 * page. The comparison runs in the database on (created_at, id), so payments made in the same
 * millisecond are neither skipped nor repeated. Filter by `link` (a link or widget id), by `status`
 * (the five values a payment's `status` takes), or by `before`, a time.
 */
export const GET = apiRoute(async (request, { orgId }) => {
  const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) throw badRequest(parsed.error.issues[0]?.message ?? "Invalid query.", "invalid_query");
  const { limit, before, link, status, starting_after: cursor } = parsed.data;
  const states = status ? PAYMENT_STATES.filter((state) => !UNPAID_STATES.includes(state) && dashboardStatus(state) === status) : null;
  const rows = await db()
    .select()
    .from(schema.payments)
    .where(
      and(
        eq(schema.payments.orgId, orgId),
        notInArray(schema.payments.state, UNPAID_STATES),
        states ? inArray(schema.payments.state, states) : undefined,
        link ? eq(schema.payments.sourceId, link) : undefined,
        before ? lt(schema.payments.createdAt, before) : undefined,
        // An id from another workspace matches no row, so the page is empty rather than someone else's.
        cursor ? sql`(${schema.payments.createdAt}, ${schema.payments.id}) < (select p.created_at, p.id from payments p where p.id = ${cursor} and p.org_id = ${orgId})` : undefined,
      ),
    )
    .orderBy(desc(schema.payments.createdAt), desc(schema.payments.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return json({ data: page.map(paymentEventBody), has_more: hasMore });
});
