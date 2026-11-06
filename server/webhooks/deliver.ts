import "server-only";
import { lookup } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { eq, sql } from "drizzle-orm";
import { decrypt, signWebhook } from "../crypto";
import { db, schema } from "../db";
import { env } from "../env";
import { log } from "../log";
import { notify } from "../notify";

const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 86_400_000];
const TIMEOUT_MS = 10_000;

/** Addresses a merchant-supplied URL must never reach: this machine, its network, and cloud metadata. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (version === 6) {
    const lower = address.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateAddress(mapped[1]);
    return lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || /^fe[89ab]/.test(lower) || lower.startsWith("ff");
  }
  return true;
}

export function assertWebhookUrl(value: string) {
  const url = new URL(value);
  if (env().WEBHOOKS_ALLOW_PRIVATE) return url;
  if (url.protocol !== "https:") throw new Error("Webhook URLs must use https.");
  if (url.username || url.password) throw new Error("Webhook URLs can't carry credentials.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isPrivateAddress(host)) throw new Error("Webhook URLs can't point at a private address.");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) throw new Error("Webhook URLs can't point at a private address.");
  return url;
}

/**
 * The address is checked inside the socket's own DNS lookup, so a hostname can't pass the check and then
 * resolve somewhere else when connecting. Redirects aren't followed.
 */
export function postWebhook(urlString: string, body: string, headers: Record<string, string>): Promise<number> {
  const url = assertWebhookUrl(urlString);
  const allowPrivate = env().WEBHOOKS_ALLOW_PRIVATE;
  return new Promise((resolve, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = send(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "Gateway-Webhooks/1", "Content-Length": Buffer.byteLength(body).toString(), ...headers },
        timeout: TIMEOUT_MS,
        lookup: (hostname, options, callback) => {
          lookup(hostname, { ...options, all: true }, (error, addresses) => {
            if (error) return callback(error, "", 4);
            const list = addresses as unknown as { address: string; family: number }[];
            const blocked = !allowPrivate && list.some((entry) => isPrivateAddress(entry.address));
            if (blocked) return callback(new Error("Webhook host resolves to a private address"), "", 4);
            return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
          });
        },
      },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode ?? 0));
      },
    );
    request.on("timeout", () => request.destroy(new Error("Timed out")));
    request.on("error", reject);
    request.end(body);
  });
}

export const nextAttemptDelay = (attempts: number) => BACKOFF_MS[attempts - 1] ?? null;

/** Claims due deliveries by pushing them out first, so a crash retries rather than drops. */
export async function deliverDueWebhooks(limit = 25) {
  const claimed = await db().execute<{ id: string; webhook_id: string; event_id: string; type: string; body: string; attempts: number; org_id: string }>(sql`
    update webhook_deliveries set next_attempt_at = now() + interval '5 minutes'
    where id in (
      select id from webhook_deliveries where state = 'pending' and next_attempt_at <= now()
      order by next_attempt_at limit ${limit} for update skip locked
    )
    returning id, webhook_id, event_id, type, body, attempts, org_id
  `);
  await Promise.all(claimed.rows.map((row) => attempt(row)));
  return claimed.rows.length;
}

async function attempt(row: { id: string; webhook_id: string; event_id: string; type: string; body: string; attempts: number; org_id: string }) {
  const [hook] = await db().select().from(schema.webhooks).where(eq(schema.webhooks.id, row.webhook_id)).limit(1);
  if (!hook || hook.deletedAt || !hook.enabled) {
    await db().update(schema.webhookDeliveries).set({ state: "failed", lastError: "Endpoint removed or turned off", nextAttemptAt: null }).where(eq(schema.webhookDeliveries.id, row.id));
    return;
  }
  const attempts = row.attempts + 1;
  let status = 0;
  let failure: string | null = null;
  try {
    const signature = signWebhook(row.body, decrypt(hook.secretEnc, env().SECRET_KEY), Math.floor(Date.now() / 1000));
    status = await postWebhook(hook.url, row.body, { "Gateway-Signature": signature, "Gateway-Event": row.type, "Gateway-Event-Id": row.event_id, "Gateway-Delivery": row.id });
    if (status < 200 || status >= 300) failure = `Endpoint returned ${status}`;
  } catch (error) {
    failure = (error as Error).message;
  }
  if (!failure) {
    await db().update(schema.webhookDeliveries).set({ state: "delivered", attempts, lastStatus: status, lastError: null, deliveredAt: new Date(), nextAttemptAt: null }).where(eq(schema.webhookDeliveries.id, row.id));
    return;
  }
  const delay = nextAttemptDelay(attempts);
  await db().update(schema.webhookDeliveries).set({ state: delay === null ? "failed" : "pending", attempts, lastStatus: status || null, lastError: failure, nextAttemptAt: delay === null ? null : new Date(Date.now() + delay) }).where(eq(schema.webhookDeliveries.id, row.id));
  if (delay === null) {
    log("warn", "webhook delivery gave up", { deliveryId: row.id, webhookId: row.webhook_id, failure });
    await notify(db(), { orgId: row.org_id, kind: "webhook_failed", title: "A webhook couldn't be delivered", body: `${hook.url} didn't accept ${row.type} after ${attempts} tries. You can resend it from Settings.`, href: "/dashboard/settings?tab=developers" });
  }
}
