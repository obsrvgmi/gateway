import { sql } from "drizzle-orm";
import { db, schema } from "@/server/db";
import { paymentsMode } from "@/server/env";
import { json, publicRoute } from "@/server/http/route";

const STALE_SECONDS = 120;

/** 503 when the database is down or the worker has stopped, because then payments aren't being tracked. */
export const GET = publicRoute(async () => {
  try {
    await db().execute(sql`select 1`);
    const beats = await db().select().from(schema.heartbeats);
    const pollBeat = beats.find((beat) => beat.name === "poll-payments");
    const workerAge = pollBeat ? Math.round((Date.now() - pollBeat.at.getTime()) / 1000) : null;
    const healthy = workerAge !== null && workerAge < STALE_SECONDS;
    return json({ status: healthy ? "ok" : "worker_stalled", mode: paymentsMode(), workerAgeSeconds: workerAge }, { status: healthy ? 200 : 503 });
  } catch {
    return json({ status: "database_unavailable" }, { status: 503 });
  }
});
