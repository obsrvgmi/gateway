import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

/** One real Postgres for the whole run. Each test file gets its own database in it. */
export default async function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), "gateway-pg-"));
  const port = 54_000 + Math.floor(Math.random() * 1000);
  const server = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port, persistent: false, onLog: () => {}, onError: () => {} });
  await server.initialise();
  await server.start();
  process.env.TEST_POSTGRES_URL = `postgres://postgres:postgres@localhost:${port}`;
  return async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}
