import { z } from "zod";
import { paymentsMode } from "@/server/env";
import { conflict, notFound } from "@/server/http/errors";
import { json, orgRoute, readJson } from "@/server/http/route";
import { clearSample, hasSample, loadSample } from "@/server/sample";

const body = z.object({ action: z.enum(["load", "clear"]) });

/** Doesn't exist in live mode: made-up history must never sit beside real money. */
export const POST = orgRoute("settings:write", async (request, { orgId }) => {
  if (paymentsMode() === "live") throw notFound();
  const { action } = await readJson(request, body);
  if (action === "clear") {
    await clearSample(orgId);
    return json({ ok: true });
  }
  if (await hasSample(orgId)) throw conflict("Sample data is already loaded.");
  await loadSample(orgId);
  return json({ ok: true });
});
