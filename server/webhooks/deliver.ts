import "server-only";
import { lookup } from "node:dns";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { eq, sql } from "drizzle-orm";
import { decrypt, signWebhook } from "../crypto";
import { db, schema } from "../db";
import { env } from "../env";
import { log } from "../log";
import { notify } from "../notify";

const BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 86_400_000];
const TIMEOUT_MS = 10_000;

/**
 * Addresses a merchant-supplied URL must never reach: this machine, its network, and cloud metadata.
 * `BlockList` compares parsed addresses, so `::ffff:7f00:1` is the same as `127.0.0.1`.
 */
const PRIVATE = new BlockList();
for (const [network, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3]] as const) PRIVATE.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8], ["64:ff9b::", 96], ["2002::", 16], ["2001:db8::", 32]] as const) PRIVATE.addSubnet(network, prefix, "ipv6");

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 0) return true;
  return PRIVATE.check(address, version === 4 ? "ipv4" : "ipv6");
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
 * resolve somewhere else when connecting. Redirects aren't followed. The outcome is known from the status
 * line, so the body is never read, and a hard deadline means a slow or broken endpoint can't hold this up.
 */
export async function postWebhook(urlString: string, body: string, headers: Record<string, string>, deadlineMs = TIMEOUT_MS): Promise<number> {
  const url = assertWebhookUrl(urlString);
  const allowPrivate = env().WEBHOOKS_ALLOW_PRIVATE;
  return new Promise((resolve, reject) => {
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = send(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "Gateway-Webhooks/1", "Content-Length": Buffer.byteLength(body).toString(), ...headers },
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
        clearTimeout(deadline);
        resolve(response.statusCode ?? 0);
        response.destroy();
      },
    );
    const deadline = setTimeout(() => request.destroy(new Error("Timed out")), deadlineMs);
    request.on("error", (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    request.end(body);
  });
}

/** What a merchant sees. Socket error codes would let them map which ports are open behind us. */
const deliveryError = (error: unknown) => {
  const { message } = error as Error;
  if (/private address|must use https|credentials/.test(message)) return "This endpoint's address isn't allowed.";
  if (message === "Timed out") return "The endpoint didn't respond in time.";
  return "Couldn't connect to the endpoint.";
};

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
  await Promise.allSettled(claimed.rows.map((row) => attempt(row)));
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
    failure = deliveryError(error);
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
