import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const defaultFolder = () => process.env.MIGRATIONS_DIR ?? path.join(process.cwd(), "server/db/migrations");

/** Applies committed SQL migrations. Takes the URL directly, so it needs no other configuration. */
export async function runMigrations(url: string, migrationsFolder = defaultFolder()) {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && /migrate\.(ts|mjs|js)$/.test(process.argv[1])) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  void runMigrations(url).then(() => console.log(JSON.stringify({ level: "info", msg: "migrations applied" })));
}
