import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../env";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Either a plain connection or an open transaction. */
export type Db = Database | Tx;

// Survives hot reload in dev, so edits don't leak a pool each time.
const holder = globalThis as unknown as { __gatewayDb?: { url: string; pool: Pool; db: Database } };

export function db(): Database {
  const url = env().DATABASE_URL;
  if (holder.__gatewayDb?.url !== url) {
    void holder.__gatewayDb?.pool.end();
    const pool = new Pool({ connectionString: url, max: 10 });
    pool.on("error", (error) => console.error(JSON.stringify({ level: "error", msg: "postgres pool error", error: error.message })));
    holder.__gatewayDb = { url, pool, db: drizzle(pool, { schema }) };
  }
  return holder.__gatewayDb.db;
}

export async function closeDb() {
  await holder.__gatewayDb?.pool.end();
  holder.__gatewayDb = undefined;
}

export { schema };
