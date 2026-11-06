import { sql } from "drizzle-orm";
import { db } from "../db";
import { tooMany } from "./errors";

/** Counts a hit in a fixed window. Stored in Postgres, so every web instance shares the limit. */
export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const result = await db().execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, ${windowStart.toISOString()}, 1)
    on conflict (key, window_start) do update set count = rate_limits.count + 1
    returning count
  `);
  if (Number(result.rows[0].count) > limit) throw tooMany();
}
