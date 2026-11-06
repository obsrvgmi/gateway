/**
 * Operator controls. Run where DATABASE_URL points at the target database:
 *
 *   npm run ops -- status
 *   npm run ops -- pause payments "Provider incident"     stop every new quote
 *   npm run ops -- pause chain:bsc "Chain halted"         stop one chain
 *   npm run ops -- pause asset:ARB "Low liquidity"        stop one asset
 *   npm run ops -- resume chain:bsc
 *   npm run ops -- screen add <address> "reason"          add to the sanctions list by hand
 *   npm run ops -- screen remove <address>                take off the list after review
 *
 * Pausing stops new quotes only. Payments already in flight keep being tracked to the end.
 */
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../server/db/schema";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool, { schema });
  const [command, target, detail] = process.argv.slice(2);
  try {
    if (command === "status") {
      console.table(await db.select().from(schema.routeControls));
      console.table(await db.select().from(schema.heartbeats));
      console.log("screened addresses:", (await db.select({ a: schema.screenedAddresses.address }).from(schema.screenedAddresses)).length);
    } else if ((command === "pause" || command === "resume") && target && /^(payments|chain:[a-z0-9]+|asset:[A-Z0-9]+)$/.test(target)) {
      const paused = command === "pause";
      await db.insert(schema.routeControls).values({ key: target, paused, reason: detail ?? "" }).onConflictDoUpdate({ target: schema.routeControls.key, set: { paused, reason: detail ?? "", updatedAt: new Date() } });
      await db.insert(schema.auditLog).values({ orgId: null, actorType: "system", actorId: "ops", action: `route.${command}`, target, detail: { reason: detail ?? "" } });
      console.log(`${target} ${paused ? "paused" : "resumed"}`);
    } else if (command === "screen" && target === "add" && detail) {
      await db.insert(schema.screenedAddresses).values({ address: detail.trim().toLowerCase(), source: process.argv[5] ?? "manual" }).onConflictDoNothing();
      await db.insert(schema.auditLog).values({ orgId: null, actorType: "system", actorId: "ops", action: "screening.added", target: detail });
      console.log("added");
    } else if (command === "screen" && target === "remove" && detail) {
      await db.delete(schema.screenedAddresses).where(eq(schema.screenedAddresses.address, detail.trim().toLowerCase()));
      await db.insert(schema.auditLog).values({ orgId: null, actorType: "system", actorId: "ops", action: "screening.removed", target: detail });
      console.log("removed");
    } else {
      console.log("Usage: status | pause <payments|chain:x|asset:Y> [reason] | resume <key> | screen add <address> [reason] | screen remove <address>");
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

void main();
