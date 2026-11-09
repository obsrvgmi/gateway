import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession as createUserSession, SESSION_COOKIE } from "@/server/auth/session";
import { db, schema } from "@/server/db";
import { hashSecret, newId, newSecret } from "@/server/ids";
import { createSession } from "@/server/payments/checkout";
import { applyPaymentStatus } from "@/server/payments/poller";
import { provider } from "@/server/payments/provider";
import type { SimProvider } from "@/server/payments/provider/sim";
import { paymentEventBody } from "@/server/payments/serialize";
import { closedReason, loadSource, publicSource } from "@/server/payments/source";
import { OPENAPI } from "@/lib/openapi";
import { returnUrl } from "@/lib/return-url";
import { GET as publicStats } from "@/app/api/checkout/[sourceId]/stats/route";
import { PATCH as patchLink } from "@/app/api/links/[id]/route";
import { POST as postLink } from "@/app/api/links/route";
import { GET as openapiRoute } from "@/app/api/v1/openapi.json/route";
import { GET as v1Link, PATCH as v1PatchLink } from "@/app/api/v1/payment-links/[id]/route";
import { POST as v1CreateLink } from "@/app/api/v1/payment-links/route";
import { GET as v1Payment } from "@/app/api/v1/payments/[id]/route";
import { GET as v1Payments } from "@/app/api/v1/payments/route";
import { GET as v1Stats } from "@/app/api/v1/stats/route";
import { PATCH as patchWidget } from "@/app/api/widgets/[id]/route";
import { APP_URL, createOrg, freshDatabase, paymentById, WALLET_KEY } from "./support/db";

let close: () => Promise<void>;
beforeAll(async () => {
  ({ close } = await freshDatabase());
});
afterAll(async () => close());

type Handler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(handler: Handler, options: { method?: string; body?: unknown; bearer?: string; token?: string; params?: Record<string, string>; path?: string; origin?: string | null } = {}) {
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  const headers = new Headers();
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.bearer) headers.set("authorization", `Bearer ${options.bearer}`);
  if (options.token) headers.set("cookie", `${SESSION_COOKIE}=${options.token}`);
  if (method !== "GET" && options.token && options.origin !== null) headers.set("origin", options.origin ?? APP_URL);
  const request = new NextRequest(`${APP_URL}${options.path ?? "/x"}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const response = await handler(request, { params: Promise.resolve(options.params ?? {}) });
  // Response bodies are read loosely here; their shapes are what each test asserts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: response.status, headers: response.headers, body: (await response.json()) as Record<string, any> };
}

const wallet = privateKeyToAccount(WALLET_KEY).address.toLowerCase();
const CUSTOMER = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const idem = () => randomBytes(8).toString("hex");

async function merchant() {
  const fixture = await createOrg({ walletAddress: wallet, walletVerifiedAt: new Date() });
  const secret = `gw_test_${newSecret()}`;
  await db().insert(schema.apiKeys).values({ id: newId("key_"), orgId: fixture.orgId, label: "k", prefix: secret.slice(0, 12), keyHash: hashSecret(secret), createdBy: fixture.userId });
  const { token } = await createUserSession(fixture.userId, fixture.orgId);
  return { ...fixture, secret, token };
}

async function apiLink(secret: string, body: Record<string, unknown>) {
  const result = await call(v1CreateLink as Handler, { bearer: secret, body: { title: "Order 1234", amount: 50, receiveAsset: "USDC", ...body } });
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return result.body;
}

/** A payment row as the poller would leave it. */
async function paymentRow(orgId: string, sourceId: string, state: string, overrides: Partial<typeof schema.payments.$inferInsert> = {}) {
  const id = newId("pay_");
  await db().insert(schema.payments).values({ id, orgId, sourceType: sourceId.startsWith("wgt_") ? "widget" : "link", sourceId, sourceName: "x", state, payAsset: "ETH", receiveAsset: "USDC", usd: "10", receiveBase: "10000000", payer: CUSTOMER, settlementMode: "balance", recipient: wallet, recipientType: "INTENTS", live: false, ...overrides });
  return id;
}

describe("metadata", () => {
  it("is kept on the link, copied to its payments, and carried by the API and webhooks", async () => {
    const { secret } = await merchant();
    const link = await apiLink(secret, { metadata: { order_id: "1234", customer: "c_9" } });
    expect(link.metadata).toEqual({ order_id: "1234", customer: "c_9" });

    const source = await loadSource(link.id);
    const session = await createSession(source, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: idem() });
    const row = await paymentById(session.id);
    expect(row.metadata).toEqual({ order_id: "1234", customer: "c_9" });
    expect(paymentEventBody(row).metadata).toEqual({ order_id: "1234", customer: "c_9" });

    // A later change to the link doesn't rewrite what a payment was made for.
    await call(v1PatchLink as Handler, { method: "PATCH", bearer: secret, params: { id: link.id }, body: { metadata: { order_id: "9999" } } });
    expect((await paymentById(session.id)).metadata).toEqual({ order_id: "1234", customer: "c_9" });
    expect((await call(v1Link as Handler, { bearer: secret, params: { id: link.id } })).body.metadata).toEqual({ order_id: "9999" });
  });

  it("isn't shown to the customer", async () => {
    const { secret } = await merchant();
    const link = await apiLink(secret, { metadata: { internal_note: "vip" } });
    expect(JSON.stringify(await publicSource(await loadSource(link.id)))).not.toContain("vip");
  });

  it.each([
    ["more than 20 keys", Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, "v"]))],
    ["a value that isn't a string", { order_id: 1234 }],
    ["a key that is too long", { ["k".repeat(41)]: "v" }],
    ["a key with spaces", { "order id": "v" }],
    ["a value over 500 characters", { note: "x".repeat(501) }],
  ])("refuses %s", async (_, metadata) => {
    const { secret } = await merchant();
    const result = await call(v1CreateLink as Handler, { bearer: secret, body: { title: "x", amount: 5, receiveAsset: "USDC", metadata } });
    expect(result.status).toBe(400);
  });

  it("survives a dashboard edit and a dashboard re-save that don't mention it", async () => {
    const { secret, token } = await merchant();
    const link = await apiLink(secret, { metadata: { order_id: "1" }, singleUse: true, publicStats: true });
    expect((await call(patchLink as Handler, { method: "PATCH", token, params: { id: link.id }, body: { title: "Renamed" } })).status).toBe(200);
    const resaved = await call(postLink as Handler, { token, body: { id: link.id, title: "Renamed", description: "", amount: 50, receiveAsset: "USDC", status: "active", expiresAt: null, successUrl: "" } });
    expect(resaved.status).toBe(201);
    const row = (await db().select().from(schema.paymentLinks).where(eq(schema.paymentLinks.id, link.id)))[0];
    expect(row.metadata).toEqual({ order_id: "1" });
    expect(row.singleUse).toBe(true);
    expect(row.publicStats).toBe(true);
  });
});

describe("single-use links", () => {
  it("stay open while a customer is choosing, and close once money arrives", async () => {
    const { secret } = await merchant();
    const link = await apiLink(secret, { singleUse: true });
    const session = await createSession(await loadSource(link.id), { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: idem() });
    // Only an address issued: someone may still be choosing how to pay.
    expect(closedReason(await loadSource(link.id))).toBeNull();

    const sim = provider() as SimProvider;
    await sim.simulateDeposit(session.depositAddress as string, "pay");
    expect((await applyPaymentStatus(session.id, await sim.status(session.depositAddress as string)))?.state).toBe("deposit_seen");

    const closed = await loadSource(link.id);
    expect(closedReason(closed)).toBe("This link has already been paid.");
    await expect(createSession(closed, { payAsset: "ETH", refundAddress: CUSTOMER, idempotencyKey: idem() })).rejects.toMatchObject({ code: "source_closed" });
    // The customer who paid still sees their own payment.
    expect((await call(v1Payment as Handler, { bearer: secret, params: { id: session.id } })).body.status).toBe("processing");
  });

  it.each(["failed", "expired", "quote_failed", "provider_refunded"])("reopen when the only payment ended %s", async (state) => {
    const { orgId, secret } = await merchant();
    const link = await apiLink(secret, { singleUse: true });
    await paymentRow(orgId, link.id, state);
    expect(closedReason(await loadSource(link.id))).toBeNull();
  });

  it.each(["settled", "refunded", "refund_pending", "underpaid", "processing"])("stay closed after a payment that is %s", async (state) => {
    const { orgId, secret } = await merchant();
    const link = await apiLink(secret, { singleUse: true });
    await paymentRow(orgId, link.id, state);
    expect(closedReason(await loadSource(link.id))).toBe("This link has already been paid.");
  });

  it("don't count a payment for another link", async () => {
    const { orgId, secret } = await merchant();
    const link = await apiLink(secret, { singleUse: true });
    const other = await apiLink(secret, {});
    await paymentRow(orgId, other.id, "settled");
    expect(closedReason(await loadSource(link.id))).toBeNull();
  });

  it("are reusable by default", async () => {
    const { orgId, secret } = await merchant();
    const link = await apiLink(secret, {});
    expect(link.singleUse).toBe(false);
    await paymentRow(orgId, link.id, "settled");
    expect(closedReason(await loadSource(link.id))).toBeNull();
  });
});

describe("listing payments", () => {
  it("filters by link and status, and pages with a cursor", async () => {
    const { orgId, secret } = await merchant();
    const link = await apiLink(secret, {});
    const other = await apiLink(secret, {});
    const base = Date.now() - 60_000;
    for (let i = 0; i < 5; i++) await paymentRow(orgId, link.id, i % 2 ? "settled" : "expired", { createdAt: new Date(base + i * 1000) });
    await paymentRow(orgId, other.id, "settled");

    const byLink = await call(v1Payments as Handler, { bearer: secret, path: `/api/v1/payments?link=${link.id}` });
    expect(byLink.body.data).toHaveLength(5);
    expect(byLink.body.data.every((p: { source: { id: string } }) => p.source.id === link.id)).toBe(true);
    expect(byLink.body.has_more).toBe(false);

    const settled = await call(v1Payments as Handler, { bearer: secret, path: `/api/v1/payments?link=${link.id}&status=settled` });
    expect(settled.body.data.map((p: { status: string }) => p.status)).toEqual(["settled", "settled"]);

    const first = await call(v1Payments as Handler, { bearer: secret, path: `/api/v1/payments?link=${link.id}&limit=3` });
    expect(first.body.data).toHaveLength(3);
    expect(first.body.has_more).toBe(true);
    const second = await call(v1Payments as Handler, { bearer: secret, path: `/api/v1/payments?link=${link.id}&limit=3&starting_after=${first.body.data.at(-1).id}` });
    expect(second.body.data).toHaveLength(2);
    expect(second.body.has_more).toBe(false);
    const ids = [...first.body.data, ...second.body.data].map((p: { id: string }) => p.id);
    expect(new Set(ids).size).toBe(5);
  });

  it("doesn't page into another workspace with someone else's cursor", async () => {
    const mine = await merchant();
    const theirs = await merchant();
    // Mine is older than their cursor, so a cursor read across workspaces would return it.
    await paymentRow(mine.orgId, "lnk_m", "settled", { createdAt: new Date(Date.now() - 60_000) });
    const theirPayment = await paymentRow(theirs.orgId, "lnk_t", "settled");
    const page = await call(v1Payments as Handler, { bearer: mine.secret, path: `/api/v1/payments?starting_after=${theirPayment}` });
    expect(page.status).toBe(200);
    expect(page.body.data).toEqual([]);
  });

  it("refuses an unknown status rather than ignoring it", async () => {
    const { secret } = await merchant();
    expect((await call(v1Payments as Handler, { bearer: secret, path: "/api/v1/payments?status=paid" })).status).toBe(400);
  });
});

describe("stats for the merchant's server", () => {
  it("counts what the dashboard counts, for its own workspace only", async () => {
    const { orgId, secret } = await merchant();
    const theirs = await merchant();
    const link = await apiLink(secret, {});
    await paymentRow(orgId, link.id, "settled", { usd: "30" });
    await paymentRow(orgId, link.id, "settled", { usd: "20" });
    await paymentRow(orgId, link.id, "processing", { usd: "99" });
    await paymentRow(orgId, link.id, "refunded", { usd: "5" });
    await paymentRow(orgId, link.id, "expired", { usd: "7" });
    // An address issued but never paid isn't a payment yet.
    await paymentRow(orgId, link.id, "awaiting_deposit", { usd: "1000" });
    await paymentRow(theirs.orgId, "lnk_theirs", "settled", { usd: "500" });

    const { status, body } = await call(v1Stats as Handler, { bearer: secret, path: `/api/v1/stats?link=${link.id}` });
    expect(status).toBe(200);
    expect(body.volume_usd).toBe(50);
    expect(body.payments).toEqual({ total: 5, settled: 2, processing: 1, refunded: 1, failed: 0, expired: 1 });
    // In-flight payments have no outcome yet: 2 settled of 4 resolved.
    expect(body.success_rate).toBe(0.5);
    expect(body.by_pay_asset).toEqual([{ asset: "ETH", volume_usd: 50, payments: 2 }]);
    expect(body.live).toBe(false);
    // Unfiltered, it's still this workspace alone: theirs, and every other test's, stay out.
    expect((await call(v1Stats as Handler, { bearer: secret, path: "/api/v1/stats" })).body.volume_usd).toBe(50);
  });

  it("limits to a time window", async () => {
    const { orgId, secret } = await merchant();
    await paymentRow(orgId, "lnk_a", "settled", { usd: "10", createdAt: new Date("2026-01-01T00:00:00Z") });
    await paymentRow(orgId, "lnk_a", "settled", { usd: "15", createdAt: new Date("2026-02-01T00:00:00Z") });
    const { body } = await call(v1Stats as Handler, { bearer: secret, path: "/api/v1/stats?since=2026-01-15T00:00:00Z&until=2026-03-01T00:00:00Z" });
    expect(body.volume_usd).toBe(15);
  });

  it("needs a key", async () => {
    expect((await call(v1Stats as Handler)).status).toBe(401);
  });
});

describe("public stats", () => {
  it("are off unless the merchant turns them on, and then show only totals", async () => {
    const { orgId, secret } = await merchant();
    const link = await apiLink(secret, { metadata: { secret_note: "hidden" } });
    await paymentRow(orgId, link.id, "settled", { usd: "40", customerEmail: "buyer@example.com" });
    await paymentRow(orgId, link.id, "settled", { usd: "2.5" });
    await paymentRow(orgId, link.id, "refunded", { usd: "100" });
    await paymentRow(orgId, link.id, "processing", { usd: "100" });

    expect((await call(publicStats as Handler, { params: { sourceId: link.id } })).status).toBe(404);

    await call(v1PatchLink as Handler, { method: "PATCH", bearer: secret, params: { id: link.id }, body: { publicStats: true } });
    const { status, headers, body } = await call(publicStats as Handler, { params: { sourceId: link.id } });
    expect(status).toBe(200);
    expect(headers.get("access-control-allow-origin")).toBe("*");
    expect(body).toEqual({ source: link.id, raised_usd: 42.5, payments: 2, currency: "USD", live: false });
    expect(JSON.stringify(body)).not.toMatch(/buyer@|hidden|0x/i);
  });

  it("work for a widget the merchant opted in", async () => {
    const { orgId, token } = await merchant();
    const widgetId = newId("wgt_");
    await db().insert(schema.widgets).values({ id: widgetId, orgId, name: "Tips", accent: "#00EC97", receiveAsset: "USDC", acceptedAssets: ["ETH"], presets: [], success: { mode: "receipt", message: "", url: "" } });
    await paymentRow(orgId, widgetId, "settled", { usd: "3" });
    expect((await call(publicStats as Handler, { params: { sourceId: widgetId } })).status).toBe(404);
    expect((await call(patchWidget as Handler, { method: "PATCH", token, params: { id: widgetId }, body: { publicStats: true } })).status).toBe(200);
    expect((await call(publicStats as Handler, { params: { sourceId: widgetId } })).body.raised_usd).toBe(3);
  });

  it("are gone once the link is deleted", async () => {
    const { secret } = await merchant();
    const link = await apiLink(secret, { publicStats: true });
    await db().update(schema.paymentLinks).set({ deletedAt: new Date() }).where(eq(schema.paymentLinks.id, link.id));
    expect((await call(publicStats as Handler, { params: { sourceId: link.id } })).status).toBe(404);
  });
});

describe("return to the merchant", () => {
  it("adds the payment and source to the success URL, keeping its own query", () => {
    expect(returnUrl("https://shop.example/thanks?order=12", { paymentId: "pay_1", sourceId: "lnk_2" })).toBe("https://shop.example/thanks?order=12&payment_id=pay_1&source_id=lnk_2");
    expect(returnUrl("https://shop.example/thanks#top", { paymentId: "pay_1", sourceId: "lnk_2" })).toBe("https://shop.example/thanks?payment_id=pay_1&source_id=lnk_2#top");
  });

  it("refuses anything but http and https", () => {
    expect(returnUrl("javascript:alert(1)", { paymentId: "pay_1", sourceId: "lnk_2" })).toBeNull();
    expect(returnUrl("", { paymentId: "pay_1", sourceId: "lnk_2" })).toBeNull();
  });
});

describe("the OpenAPI description", () => {
  const routeFiles = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? routeFiles(full) : name === "route.ts" ? [full] : [];
  });

  it("documents every v1 route and method, and nothing that doesn't exist", () => {
    const root = path.resolve("app/api/v1");
    const actual = new Set<string>();
    for (const file of routeFiles(root)) {
      const route = `/api/v1/${path.relative(root, path.dirname(file)).split(path.sep).join("/")}`.replace(/\[(\w+)\]/g, "{$1}");
      if (route === "/api/v1/openapi.json") continue;
      for (const [, method] of readFileSync(file, "utf8").matchAll(/export const (GET|POST|PATCH|PUT|DELETE)\b/g)) actual.add(`${method.toLowerCase()} ${route}`);
    }
    const methods = ["get", "post", "patch", "put", "delete"];
    const documented = new Set(Object.entries(OPENAPI.paths).flatMap(([route, item]) => Object.keys(item).filter((key) => methods.includes(key)).map((method) => `${method} ${route}`)));
    expect([...documented].sort()).toEqual([...actual].sort());
  });

  it("is served as JSON with the server's own origin", async () => {
    const { status, body } = await call(openapiRoute as Handler, { path: "/api/v1/openapi.json" });
    expect(status).toBe(200);
    expect(body.openapi).toBe("3.1.0");
    expect(body.servers[0].url).toBe(APP_URL);
  });
});
