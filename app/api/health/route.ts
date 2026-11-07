import { sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { liveGateFailures, liveRefused, paymentsMode } from "@/server/env";
import { json, publicRoute } from "@/server/http/route";

const STALE_SECONDS = 120;
/** A stall in any of these means customers or merchants stop hearing what happened. */
const CRITICAL_JOBS = ["poll-payments", "poll-payouts", "poll-refunds", "outbox", "webhooks"];

/** 503 when the database is down or the worker has stopped, because then payments aren't being tracked. */
export const GET = publicRoute(async () => {
  try {
    await db().execute(sql`select 1`);
    if (liveRefused()) return json({ status: "live_refused", reasons: liveGateFailures() }, { status: 503 });
    const beats = await db().select().from(schema.heartbeats);
    const ages = CRITICAL_JOBS.map((name) => {
      const beat = beats.find((item) => item.name === name);
      return beat ? Math.round((Date.now() - beat.at.getTime()) / 1000) : null;
    });
    const healthy = ages.every((age) => age !== null && age < STALE_SECONDS);
    return json({ status: healthy ? "ok" : "worker_stalled", mode: paymentsMode(), workerAgeSeconds: ages.some((age) => age === null) ? null : Math.max(...(ages as number[])) }, { status: healthy ? 200 : 503 });
  } catch {
    return json({ status: "database_unavailable" }, { status: 503 });
  }
});
