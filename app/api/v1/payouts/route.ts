import { and, desc, eq, notInArray } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { apiRoute } from "@/server/http/api-key";
import { json } from "@/server/http/route";
import { toPayout } from "@/server/payments/serialize";

/** Read only. Moving money needs the merchant's wallet, which an API key can never stand in for. */
export const GET = apiRoute(async (_request, { orgId }) => {
  const rows = await db().select().from(schema.payouts).where(and(eq(schema.payouts.orgId, orgId), notInArray(schema.payouts.state, ["awaiting_signature", "expired"]))).orderBy(desc(schema.payouts.createdAt)).limit(200);
  return json({ data: rows.map(toPayout) });
});
