import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { decrypt, encrypt, signWebhook, verifyWebhookSignature } from "@/server/crypto";
import { db, schema } from "@/server/db";
import { resetEnv } from "@/server/env";
import { newId } from "@/server/ids";
import { processOutbox, refreshSanctionsList } from "@/server/jobs";
import { emit } from "@/server/outbox";
import { assertWebhookUrl, deliverDueWebhooks, isPrivateAddress, nextAttemptDelay, postWebhook } from "@/server/webhooks/deliver";
import { createOrg, freshDatabase } from "./support/db";

const SECRET = "whsec_test";
let close: () => Promise<void>;
let server: Server;
let status = 200;
const received: { signature: string; body: string; event: string; eventId: string }[] = [];
let port = 0;

beforeAll(async () => {
  ({ close } = await freshDatabase());
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      received.push({ signature: String(request.headers["gateway-signature"]), body, event: String(request.headers["gateway-event"]), eventId: String(request.headers["gateway-event-id"]) });
      response.writeHead(status).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  server.close();
  await close();
});
beforeEach(() => {
  received.length = 0;
  status = 200;
  process.env.WEBHOOKS_ALLOW_PRIVATE = "true";
  resetEnv();
});

async function hook(orgId: string, events = ["payment.settled"]) {
  const id = newId("whk_");
  await db().insert(schema.webhooks).values({ id, orgId, url: `http://127.0.0.1:${port}/h`, events, secretEnc: encrypt(SECRET, process.env.SECRET_KEY as string) });
  return id;
}

describe("private addresses", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "198.18.0.1", "224.0.0.1", "::1", "::", "fc00::1", "fd12::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "not-an-ip"])("blocks %s", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "1.1.1.1", "172.32.0.1", "192.169.0.1", "100.128.0.1", "2606:4700::1111", "::ffff:8.8.8.8"])("allows %s", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });

  it("refuses URLs it can judge without a lookup", async () => {
    process.env.WEBHOOKS_ALLOW_PRIVATE = "false";
    resetEnv();
    await expect(postWebhook("https://127.0.0.1/h", "{}", {})).rejects.toThrow(/private/);
    expect(() => assertWebhookUrl("https://user:pass@example.com/h")).toThrow(/credentials/);
    expect(() => assertWebhookUrl("http://example.com/h")).toThrow(/https/);
    expect(() => assertWebhookUrl("https://example.com/h")).not.toThrow();
  });
});

describe("signing", () => {
  const NOW = 1_800_000_000;

  it("verifies its own signature, and nothing else", () => {
    const header = signWebhook('{"a":1}', SECRET, NOW);
    expect(verifyWebhookSignature(header, '{"a":1}', SECRET, NOW)).toBe(true);
    expect(verifyWebhookSignature(header, '{"a":2}', SECRET, NOW)).toBe(false);
    expect(verifyWebhookSignature(header, '{"a":1}', "whsec_other", NOW)).toBe(false);
  });

  it("refuses an old signature, so a captured request can't be replayed", () => {
    expect(verifyWebhookSignature(signWebhook("{}", SECRET, NOW), "{}", SECRET, NOW + 301)).toBe(false);
    expect(verifyWebhookSignature(signWebhook("{}", SECRET, NOW), "{}", SECRET, NOW + 299)).toBe(true);
  });

  it("refuses garbage rather than throwing", () => {
    expect(verifyWebhookSignature("nonsense", "{}", SECRET, NOW)).toBe(false);
    expect(verifyWebhookSignature(`t=${NOW},v1=zz`, "{}", SECRET, NOW)).toBe(false);
  });
});

describe("encryption", () => {
  it("round trips, and detects tampering or the wrong key", () => {
    const sealed = encrypt("secret", "k".repeat(32));
    expect(decrypt(sealed, "k".repeat(32))).toBe("secret");
    expect(() => decrypt(sealed, "j".repeat(32))).toThrow();
    const parts = sealed.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decrypt(parts.join("."), "k".repeat(32))).toThrow();
    expect(encrypt("secret", "k".repeat(32))).not.toBe(sealed);
  });
});

describe("delivery", () => {
  it("sends a signed event to endpoints that asked for it, once", async () => {
    const { orgId } = await createOrg();
    await hook(orgId, ["payment.settled"]);
    const other = await hook(orgId, ["payment.refunded"]);
    await emit(db(), orgId, "payment.settled", { id: "pay_1", amount_usd: 5, source: { name: "x" } });
    await processOutbox();
    await processOutbox();
    await deliverDueWebhooks();
    await deliverDueWebhooks();
    expect(received.length).toBe(1);
    expect(received[0].event).toBe("payment.settled");
    expect(verifyWebhookSignature(received[0].signature, received[0].body, SECRET, Math.floor(Date.now() / 1000))).toBe(true);
    expect(JSON.parse(received[0].body).data.id).toBe("pay_1");
    expect((await db().select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.webhookId, other))).length).toBe(0);
  });

  it("doesn't send internal alerts to merchants' servers", async () => {
    const { orgId } = await createOrg();
    await hook(orgId, ["alert.wallet_changed"]);
    await emit(db(), orgId, "alert.wallet_changed", { to: "0x1" });
    await processOutbox();
    await deliverDueWebhooks();
    expect(received.length).toBe(0);
    const notes = await db().select().from(schema.notifications).where(eq(schema.notifications.orgId, orgId));
    expect(notes[0].title).toContain("Settlement wallet changed");
  });

  it("retries a failure later, then gives up and tells the merchant", async () => {
    const { orgId } = await createOrg();
    await hook(orgId);
    status = 500;
    await emit(db(), orgId, "payment.settled", { id: "pay_2", source: {} });
    await processOutbox();
    await deliverDueWebhooks();
    const [first] = await db().select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.orgId, orgId));
    expect(first.state).toBe("pending");
    expect(first.attempts).toBe(1);
    expect(first.lastStatus).toBe(500);
    expect(first.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 30_000);

    await db().update(schema.webhookDeliveries).set({ attempts: 6, nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(schema.webhookDeliveries.id, first.id));
    await deliverDueWebhooks();
    const [last] = await db().select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.id, first.id));
    expect(last.state).toBe("failed");
    expect(last.nextAttemptAt).toBeNull();
    expect((await db().select().from(schema.notifications).where(eq(schema.notifications.orgId, orgId))).some((note) => note.kind === "webhook_failed")).toBe(true);
  });

  it("gives one delivery to one worker at a time", async () => {
    const { orgId } = await createOrg();
    await hook(orgId);
    await emit(db(), orgId, "payment.settled", { id: "pay_3", source: {} });
    await processOutbox();
    await Promise.all([deliverDueWebhooks(), deliverDueWebhooks(), deliverDueWebhooks()]);
    expect(received.filter((item) => JSON.parse(item.body).data.id === "pay_3").length).toBe(1);
  });

  it("stops for a removed endpoint", async () => {
    const { orgId } = await createOrg();
    const id = await hook(orgId);
    await emit(db(), orgId, "payment.settled", { id: "pay_4", source: {} });
    await processOutbox();
    await db().update(schema.webhooks).set({ deletedAt: new Date() }).where(eq(schema.webhooks.id, id));
    await deliverDueWebhooks();
    expect(received.length).toBe(0);
    expect((await db().select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.webhookId, id)))[0].state).toBe("failed");
  });

  it("backs off, and has an end", () => {
    expect(nextAttemptDelay(1)).toBe(60_000);
    expect(nextAttemptDelay(6)).toBe(86_400_000);
    expect(nextAttemptDelay(7)).toBeNull();
  });
});

describe("sanctions list refresh", () => {
  const fake = (lists: Record<string, string>): typeof fetch => (async (url: string) => {
    const name = /_([A-Z]+)\.txt$/.exec(String(url))?.[1] ?? "";
    return name in lists ? new Response(lists[name]) : new Response("", { status: 404 });
  }) as unknown as typeof fetch;

  it("adds addresses in the form they're compared, and survives a failed list", async () => {
    const added = await refreshSanctionsList(fake({ ETH: "0xABCDEF0000000000000000000000000000000001\n\n# comment\n" }));
    expect(added).toBe(1);
    const rows = await db().select().from(schema.screenedAddresses);
    expect(rows.map((row) => row.address)).toContain("0xabcdef0000000000000000000000000000000001");
  });

  it("never removes anything when a fetch fails or comes back empty", async () => {
    const before = (await db().select().from(schema.screenedAddresses)).length;
    await refreshSanctionsList(fake({}));
    await refreshSanctionsList(fake({ ETH: "" }));
    expect((await db().select().from(schema.screenedAddresses)).length).toBe(before);
  });
});
