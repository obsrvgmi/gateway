import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/server/db";
import { assertSameOrigin, json, publicRoute, readJson } from "@/server/http/route";
import { loadSession } from "@/server/payments/checkout";
import { limitCheckout } from "@/server/payments/checkout-http";
import { provider } from "@/server/payments/provider";
import { log } from "@/server/log";

const body = z.object({ txHash: z.string().trim().min(10).max(200) });

/**
 * Tells the provider which transaction to look for, which only speeds up detection. It proves nothing
 * and changes no state: the payment moves when the provider reports it, not when a browser says so.
 */
export const POST = publicRoute(async (request, { id }) => {
  assertSameOrigin(request);
  await limitCheckout(request, "deposit", 20);
  const { txHash } = await readJson(request, body);
  const row = await loadSession(id);
  // Only ever a note for this customer's own screen, so a reload can't offer them a second send.
  if (!row.clientTxHash) await db().update(schema.payments).set({ clientTxHash: txHash }).where(eq(schema.payments.id, id));
  if (row.depositAddress) {
    await provider().submitDeposit({ txHash, depositAddress: row.depositAddress, depositMemo: row.depositMemo }).catch((error) => log("warn", "deposit hint failed", { paymentId: id, error }));
  }
  return json({ ok: true });
});
