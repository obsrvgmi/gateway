import { and, eq } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { liveRefused } from "@/server/env";
import { notFound } from "@/server/http/errors";
import { json, orgRoute } from "@/server/http/route";
import { provider } from "@/server/payments/provider";
import { SimProvider } from "@/server/payments/provider/sim";
import { recordRefundDeposit } from "@/server/payments/refunds";

/**
 * Test mode's "send the refund" button. A simulated address isn't one a wallet can send to, on purpose, so
 * real funds can't go there. In live mode this route doesn't exist.
 */
export const POST = orgRoute("money:write", async (_request, { orgId, params }) => {
  const active = provider();
  if (!(active instanceof SimProvider) || liveRefused()) throw notFound();
  const [row] = await db().select().from(schema.refunds).where(and(eq(schema.refunds.id, params.id), eq(schema.refunds.orgId, orgId), eq(schema.refunds.kind, "route"))).limit(1);
  if (!row?.depositAddress || row.live) throw notFound();
  await active.simulateDeposit(row.depositAddress, "pay");
  await recordRefundDeposit({ orgId, refundId: row.id, txHash: "simulated" });
  return json({ ok: true });
});
