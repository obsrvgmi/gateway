/** Real Postgres for local work, no Docker needed: `npm run dev:db`, then set DATABASE_URL as printed. */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { runMigrations } from "../server/db/migrate";

async function main() {
  const dir = path.join(process.cwd(), ".data/postgres");
  const fresh = !existsSync(path.join(dir, "PG_VERSION"));
  mkdirSync(dir, { recursive: true });
  const port = Number(process.env.DEV_DB_PORT ?? 5433);
  const server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port, persistent: true });
  if (fresh) await server.initialise();
  await server.start();
  if (fresh) await server.createDatabase("gateway");
  const url = `postgres://postgres:postgres@localhost:${port}/gateway`;
  await runMigrations(url);
  console.log(`\nPostgres ready. DATABASE_URL=${url}\n`);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => void server.stop().then(() => process.exit(0)));
}

void main();
