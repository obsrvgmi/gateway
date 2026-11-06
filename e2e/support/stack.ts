import { spawn, type ChildProcess } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { runMigrations } from "../../server/db/migrate";

export const SECRET_KEY = "e2e-secret-key-e2e-secret-key-e2e-secret";
export const APP_URL = "http://localhost:3910";
export const RECEIVER_PORT = 3911;
export const SITE_PORT = 3912;
const APP_PORT = 3910;
const PG_PORT = 55432;

/** Fails loudly if anything else holds a port. Otherwise these tests could run against another app. */
function assertFree(port: number) {
  return new Promise<void>((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", () => reject(new Error(`Port ${port} is in use. Stop whatever holds it, or change it in e2e/support/stack.ts.`)));
    probe.listen(port, () => probe.close(() => resolve()));
  });
}

export const stackPaths = { emails: path.join(tmpdir(), "gateway-e2e-emails.jsonl"), webhooks: path.join(tmpdir(), "gateway-e2e-webhooks.jsonl") };

/** Waits for this app in particular: the health route answers in its own shape, up or degraded. */
async function waitForApp(timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const body = (await (await fetch(`${APP_URL}/api/health`)).json()) as { mode?: string };
      if (body.mode === "sim") return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`The app never came up at ${APP_URL}`);
}

/** Starts everything real: Postgres, the migrated schema, the web server, the worker, and two outside sites. */
export default async function globalSetup() {
  await Promise.all([APP_PORT, RECEIVER_PORT, SITE_PORT, PG_PORT].map(assertFree));
  const dir = mkdtempSync(path.join(tmpdir(), "gateway-e2e-pg-"));
  const postgres = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port: PG_PORT, persistent: false, onLog: () => {}, onError: () => {} });
  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase("gateway");
  const databaseUrl = `postgres://postgres:postgres@localhost:${PG_PORT}/gateway`;
  await runMigrations(databaseUrl, path.join(process.cwd(), "server/db/migrations"));

  writeFileSync(stackPaths.emails, "");
  writeFileSync(stackPaths.webhooks, "");
  const env = { ...process.env, DATABASE_URL: databaseUrl, APP_URL, PORT: String(APP_PORT), SECRET_KEY, PAYMENTS_MODE: "sim", EMAIL_PROVIDER: "file", EMAIL_FILE: stackPaths.emails, WEBHOOKS_ALLOW_PRIVATE: "true", NODE_ENV: "production" as const, HOSTNAME: "localhost" };

  const children: ChildProcess[] = [
    spawn("node", [".next/standalone/server.js"], { env, stdio: "inherit" }),
    spawn("node", ["--conditions=react-server", "dist/worker/index.mjs"], { env, stdio: ["ignore", "ignore", "inherit"] }),
  ];

  // A merchant's server, recording what it receives so a test can check each signature.
  const receiver: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      writeFileSync(stackPaths.webhooks, `${JSON.stringify({ signature: request.headers["gateway-signature"], type: request.headers["gateway-event"], body })}\n`, { flag: "a" });
      response.writeHead(200).end("ok");
    });
  }).listen(RECEIVER_PORT);

  // A merchant's own website on another origin, with the widget embedded the way our docs say.
  const site: Server = createServer((request, response) => {
    const id = new URL(request.url ?? "/", "http://x").searchParams.get("widget") ?? "";
    response.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><title>A shop</title><h1>Checkout on a merchant's site</h1><div id="host"><script src="${APP_URL}/widget.js" data-widget="${id}" async></script></div>
      <p id="events"></p><script>document.addEventListener("gateway:settled",(e)=>{document.getElementById("events").textContent="settled:"+e.detail.paymentId})</script>`);
  }).listen(SITE_PORT);

  await waitForApp();

  return async () => {
    children.forEach((child) => child.kill("SIGTERM"));
    receiver.close();
    site.close();
    await postgres.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}

export const signaturesMatch = (body: string, header: string, secret: string) => {
  const { t, v1 } = Object.fromEntries(header.split(",").map((part) => part.split("="))) as { t: string; v1: string };
  return createHmac("sha256", secret).update(`${t}.${body}`).digest("hex") === v1;
};
