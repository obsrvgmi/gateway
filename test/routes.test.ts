import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession, SESSION_COOKIE } from "@/server/auth/session";
import { db, schema } from "@/server/db";
import { resetEnv } from "@/server/env";
import { hashSecret, newId, newSecret } from "@/server/ids";
import { DELETE as deleteApiKey } from "@/app/api/api-keys/[id]/route";
import { POST as createApiKey } from "@/app/api/api-keys/route";
import { POST as requestLink } from "@/app/api/auth/request-link/route";
import { POST as verify } from "@/app/api/auth/verify/route";
import { POST as checkoutPreview } from "@/app/api/checkout/[sourceId]/preview/route";
import { GET as checkoutSource } from "@/app/api/checkout/[sourceId]/source/route";
import { POST as simPay } from "@/app/api/checkout/sessions/[id]/sim/route";
import { GET as health } from "@/app/api/health/route";
import { POST as acceptInvite } from "@/app/api/invites/accept/route";
import { DELETE as deleteLink, PATCH as patchLink } from "@/app/api/links/[id]/route";
import { POST as postLink } from "@/app/api/links/route";
import { POST as onboarding } from "@/app/api/onboarding/route";
import { POST as postPayout } from "@/app/api/payouts/route";
import { POST as postRefund } from "@/app/api/refunds/route";
import { POST as sampleData } from "@/app/api/sample-data/route";
import { PATCH as patchSettings } from "@/app/api/settings/route";
import { GET as getState } from "@/app/api/state/route";
import { POST as invite } from "@/app/api/team/invites/route";
import { DELETE as deleteMember, PATCH as patchMember } from "@/app/api/team/members/[id]/route";
import { POST as simRefund } from "@/app/api/refunds/[id]/sim/route";
import { GET as v1Links, POST as v1CreateLink } from "@/app/api/v1/payment-links/route";
import { GET as v1Payment } from "@/app/api/v1/payments/[id]/route";
import { GET as v1Payments } from "@/app/api/v1/payments/route";
import { POST as walletRoute } from "@/app/api/wallet/route";
import { GET as deliveries } from "@/app/api/webhooks/[id]/deliveries/route";
import { POST as postWebhook } from "@/app/api/webhooks/route";
import { PATCH as patchWidget } from "@/app/api/widgets/[id]/route";
import { safeNextPath } from "@/lib/safe-next";
import { cspFor } from "@/server/embed-policy";
import { clientIp } from "@/server/http/route";
import { siteHost } from "@/server/schemas";
import { APP_URL, createLink, createOrg, freshDatabase } from "./support/db";

let close: () => Promise<void>;
beforeAll(async () => {
  ({ close } = await freshDatabase());
});
afterAll(async () => close());

type Handler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

interface CallOptions {
  method?: string;
  body?: unknown;
  token?: string;
  bearer?: string;
  origin?: string | null;
  params?: Record<string, string>;
  headers?: Record<string, string>;
  path?: string;
}

async function call(handler: Handler, options: CallOptions = {}) {
  const method = options.method ?? (options.body === undefined ? "GET" : "POST");
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.token) headers.set("cookie", `${SESSION_COOKIE}=${options.token}`);
  if (options.bearer) headers.set("authorization", `Bearer ${options.bearer}`);
  if (method !== "GET" && options.origin !== null) headers.set("origin", options.origin ?? APP_URL);
  const request = new NextRequest(`${APP_URL}${options.path ?? "/x"}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const response = await handler(request, { params: Promise.resolve(options.params ?? {}) });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> & { error?: { code: string } } };
}

async function signedIn(role = "owner", overrides = {}) {
  const fixture = await createOrg(overrides, role);
  const { token } = await createSession(fixture.userId, fixture.orgId);
  return { ...fixture, token };
}

async function keyFor(orgId: string, userId: string) {
  const secret = `gw_test_${newSecret()}`;
  const id = newId("key_");
  await db().insert(schema.apiKeys).values({ id, orgId, label: "k", prefix: secret.slice(0, 12), keyHash: hashSecret(secret), createdBy: userId });
  return { secret, id };
}

const LINK = { title: "Deposit", amount: 50, receiveAsset: "USDC" };

describe("sign-in", () => {
  const email = () => `person-${newId("")}@example.com`;
  const issue = async (address: string, expiresIn = 900_000) => {
    const token = newSecret();
    await db().insert(schema.loginTokens).values({ tokenHash: hashSecret(token), email: address, expiresAt: new Date(Date.now() + expiresIn) });
    return token;
  };

  it("answers the same whether or not the account exists, and stores only a hash", async () => {
    const address = email();
    expect((await call(requestLink, { body: { email: address } })).status).toBe(200);
    const [row] = await db().select().from(schema.loginTokens).where(eq(schema.loginTokens.email, address));
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("limits how many links one address can ask for", async () => {
    const address = email();
    for (let i = 0; i < 5; i += 1) expect((await call(requestLink, { body: { email: address } })).status).toBe(200);
    expect((await call(requestLink, { body: { email: address } })).status).toBe(429);
  });

  it("refuses a request from another site", async () => {
    expect((await call(requestLink, { body: { email: email() }, origin: "https://evil.example" })).status).toBe(403);
    expect((await call(verify, { body: { token: "x".repeat(40) }, origin: null })).status).toBe(403);
  });

  it("lets a link work once, under concurrency too", async () => {
    const token = await issue(email());
    const results = await Promise.all(Array.from({ length: 4 }, () => call(verify, { body: { token, confirmed: true } })));
    expect(results.filter((result) => result.status === 200).length).toBe(1);
    expect(results.filter((result) => result.status === 401).length).toBe(3);
  });

  it("refuses an expired or unknown link", async () => {
    expect((await call(verify, { body: { token: await issue(email(), -1000), confirmed: true } })).status).toBe(401);
    expect((await call(verify, { body: { token: newSecret(), confirmed: true } })).status).toBe(401);
  });

  it("sets a session cookie that can't be read from script", async () => {
    const request = new NextRequest(`${APP_URL}/x`, { method: "POST", headers: { origin: APP_URL, "content-type": "application/json" }, body: JSON.stringify({ token: await issue(email()), confirmed: true }) });
    const response = await verify(request, { params: Promise.resolve({}) });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
  });

  describe("a link opened somewhere other than where it was asked for", () => {
    /** Asks for a link the way a browser does, and keeps what it would remember. */
    const requested = async () => {
      const address = email();
      const request = new NextRequest(`${APP_URL}/x`, { method: "POST", headers: { origin: APP_URL, "content-type": "application/json" }, body: JSON.stringify({ email: address }) });
      const response = await requestLink(request, { params: Promise.resolve({}) });
      const cookie = /gw_login=([^;]+)/.exec(response.headers.get("set-cookie") ?? "")?.[1] as string;
      const token = newSecret();
      const [row] = await db().select().from(schema.loginTokens).where(eq(schema.loginTokens.email, address));
      await db().update(schema.loginTokens).set({ tokenHash: hashSecret(token) }).where(eq(schema.loginTokens.tokenHash, row.tokenHash));
      return { address, cookie, token };
    };

    it("continues in the browser that asked", async () => {
      const { cookie, token } = await requested();
      expect((await call(verify, { body: { token }, headers: { cookie: `gw_login=${cookie}` } })).status).toBe(200);
    });

    it("doesn't silently sign someone in to an attacker's account", async () => {
      const { address, token } = await requested();
      const result = await call(verify, { body: { token } });
      expect(result.status).toBe(409);
      expect(result.body.error?.code).toBe("confirm_needed");
      expect(JSON.stringify(result.body)).toContain(`${address[0]}***@example.com`);
      // Nothing was used up by looking.
      expect((await call(verify, { body: { token, confirmed: true } })).status).toBe(200);
    });

    it("doesn't take another browser's cookie as proof", async () => {
      const first = await requested();
      const second = await requested();
      expect((await call(verify, { body: { token: first.token }, headers: { cookie: `gw_login=${second.cookie}` } })).status).toBe(409);
    });
  });

  it("needs the merchant terms to be accepted", async () => {
    const userId = newId("usr_");
    await db().insert(schema.users).values({ id: userId, email: email() });
    const { token } = await createSession(userId, null);
    expect((await call(onboarding, { token, body: { businessName: "A", receiveAsset: "USDC" } })).status).toBe(400);
    const done = await call(onboarding, { token, body: { businessName: "A", receiveAsset: "USDC", acceptTerms: true } });
    expect(done.status).toBe(201);
    const [org] = await db().select().from(schema.organizations).where(eq(schema.organizations.id, done.body.orgId as string));
    expect(org.termsVersion).toBeTruthy();
    expect(org.termsAcceptedBy).toBe(userId);
    expect((await call(onboarding, { token, body: { businessName: "B", receiveAsset: "USDC", acceptTerms: true } })).status).toBe(409);
  });
});

describe("every dashboard route needs a session", () => {
  it.each<[string, Handler, CallOptions]>([
    ["state", getState as Handler, {}],
    ["links", postLink as Handler, { body: LINK }],
    ["settings", patchSettings as Handler, { method: "PATCH", body: {} }],
    ["payouts", postPayout as Handler, { body: { asset: "USDC", amountBase: "1", receiveAsset: "USDC", destinationId: "d" } }],
    ["refunds", postRefund as Handler, { body: { paymentId: "p" } }],
    ["wallet", walletRoute as Handler, { body: {} }],
    ["webhooks", postWebhook as Handler, { body: {} }],
    ["api keys", createApiKey as Handler, { body: {} }],
  ])("%s", async (_, handler, options) => {
    expect((await call(handler, options)).status).toBe(401);
    expect((await call(handler, { ...options, token: newSecret() })).status).toBe(401);
  });

  it("refuses an expired session", async () => {
    const { userId, orgId } = await createOrg();
    const { token } = await createSession(userId, orgId);
    await db().update(schema.sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.sessions.tokenHash, hashSecret(token)));
    expect((await call(getState as Handler, { token })).status).toBe(401);
  });

  it("drops the workspace at once when someone is removed from the team", async () => {
    const { userId, orgId, token } = await signedIn("admin");
    expect((await call(postLink as Handler, { token, body: LINK })).status).toBe(201);
    await db().delete(schema.memberships).where(eq(schema.memberships.userId, userId));
    expect((await call(postLink as Handler, { token, body: LINK })).status).toBe(403);
    expect(orgId).toBeTruthy();
  });

  it("refuses a mutating request with another site's Origin, or none", async () => {
    const { token } = await signedIn();
    expect((await call(postLink as Handler, { token, body: LINK, origin: "https://evil.example" })).status).toBe(403);
    expect((await call(postLink as Handler, { token, body: LINK, origin: null })).status).toBe(403);
  });
});

describe("roles", () => {
  const CASES: [string, Handler, CallOptions, Record<string, boolean>][] = [
    ["create a link", postLink as Handler, { body: LINK }, { owner: true, admin: true, finance: false, viewer: false }],
    ["create an API key", createApiKey as Handler, { body: { label: "x" } }, { owner: true, admin: true, finance: false, viewer: false }],
    ["add a webhook", postWebhook as Handler, { body: { url: "https://example.com/h", events: ["payment.settled"] } }, { owner: true, admin: true, finance: false, viewer: false }],
    ["invite a teammate", invite as Handler, { body: { email: "new@example.com", role: "viewer" } }, { owner: true, admin: true, finance: false, viewer: false }],
    ["change settlement mode", patchSettings as Handler, { method: "PATCH", body: { settlementMode: "direct" } }, { owner: true, admin: false, finance: false, viewer: false }],
    ["change business details", patchSettings as Handler, { method: "PATCH", body: { businessName: "New" } }, { owner: true, admin: true, finance: false, viewer: false }],
    ["change payout rules", patchSettings as Handler, { method: "PATCH", body: { payouts: { holdDays: 1 } } }, { owner: true, admin: true, finance: true, viewer: false }],
  ];

  describe.each(["owner", "admin", "finance", "viewer"])("%s", (role) => {
    it.each(CASES)("%s", async (_, handler, options, allowed) => {
      const { token } = await signedIn(role);
      const result = await call(handler, { ...options, token });
      if (allowed[role]) expect(result.status, JSON.stringify(result.body)).toBeLessThan(300);
      else expect(result.status).toBe(403);
    });

    it("moving money needs the money permission", async () => {
      const { token } = await signedIn(role);
      const payout = await call(postPayout as Handler, { token, body: { asset: "USDC", amountBase: "1", receiveAsset: "USDC", destinationId: "dst_none" } });
      const refund = await call(postRefund as Handler, { token, body: { paymentId: "pay_none" } });
      if (role === "owner" || role === "finance") {
        expect(payout.status).not.toBe(403);
        expect(refund.status).not.toBe(403);
      } else {
        expect(payout.status).toBe(403);
        expect(refund.status).toBe(403);
      }
    });

    it("only an owner can touch the settlement wallet", async () => {
      const { token } = await signedIn(role);
      const result = await call(walletRoute as Handler, { token, body: { wallet: "0x0000000000000000000000000000000000000001", message: "x", newSignature: "x" } });
      if (role === "owner") expect(result.status).toBe(400);
      else expect(result.status).toBe(403);
    });
  });
});

describe("workspaces can't reach each other", () => {
  it("can't change or delete another workspace's link", async () => {
    const owner = await signedIn();
    const other = await signedIn();
    const id = await createLink(owner.orgId);
    expect((await call(patchLink as Handler, { method: "PATCH", token: other.token, body: { title: "Mine now" }, params: { id } })).status).toBe(404);
    expect((await call(deleteLink as Handler, { method: "DELETE", token: other.token, params: { id } })).status).toBe(404);
    const [row] = await db().select().from(schema.paymentLinks).where(eq(schema.paymentLinks.id, id));
    expect(row.title).toBe("Deposit");
    expect(row.deletedAt).toBeNull();
  });

  it("can't take over another workspace's link by re-creating its id", async () => {
    const owner = await signedIn();
    const other = await signedIn();
    const id = await createLink(owner.orgId, { id: `lnk_${"a".repeat(20)}` });
    expect((await call(postLink as Handler, { token: other.token, body: { ...LINK, id } })).status).toBe(409);
  });

  it("can't read another workspace's data through state", async () => {
    const owner = await signedIn();
    const other = await signedIn();
    const id = await createLink(owner.orgId);
    const state = await call(getState as Handler, { token: other.token });
    expect(JSON.stringify(state.body)).not.toContain(id);
  });

  it("can't read another workspace's webhook deliveries", async () => {
    const owner = await signedIn();
    const other = await signedIn();
    const created = await call(postWebhook as Handler, { token: owner.token, body: { url: "https://example.com/h", events: ["payment.settled"] } });
    await db().insert(schema.webhookDeliveries).values({ id: newId("whd_"), webhookId: created.body.id as string, orgId: owner.orgId, eventId: "evt", type: "x", body: "{}" });
    const result = await call(deliveries as Handler, { token: other.token, params: { id: created.body.id as string } });
    expect(result.body).toEqual([]);
  });

  it("can't revoke another workspace's API key", async () => {
    const owner = await signedIn();
    const other = await signedIn();
    const { id } = await keyFor(owner.orgId, owner.userId);
    expect((await call(deleteApiKey as Handler, { method: "DELETE", token: other.token, params: { id } })).status).toBe(404);
  });

  it("can't remove a member of another workspace, or the owner of its own", async () => {
    const owner = await signedIn();
    const other = await signedIn();
    expect((await call(deleteMember as Handler, { method: "DELETE", token: other.token, params: { id: owner.userId } })).status).toBe(404);
    expect((await call(deleteMember as Handler, { method: "DELETE", token: owner.token, params: { id: owner.userId } })).status).toBe(409);
  });
});

describe("invitations", () => {
  async function invited(email: string) {
    const owner = await signedIn();
    const token = newSecret();
    await db().insert(schema.invites).values({ id: newId("inv_"), orgId: owner.orgId, email, role: "viewer", tokenHash: hashSecret(token), invitedBy: owner.userId, expiresAt: new Date(Date.now() + 86_400_000) });
    return { owner, token };
  }

  it("works only for the address it was sent to, and only once", async () => {
    const email = `invitee-${newId("")}@example.com`;
    const { owner, token } = await invited(email);
    const stranger = await signedIn();
    expect((await call(acceptInvite as Handler, { token: stranger.token, body: { token } })).status).toBe(403);

    const userId = newId("usr_");
    await db().insert(schema.users).values({ id: userId, email });
    const session = await createSession(userId, null);
    expect((await call(acceptInvite as Handler, { token: session.token, body: { token } })).status).toBe(200);
    const [membership] = await db().select().from(schema.memberships).where(eq(schema.memberships.userId, userId));
    expect(membership.orgId).toBe(owner.orgId);
    expect(membership.role).toBe("viewer");
    expect((await call(acceptInvite as Handler, { token: session.token, body: { token } })).status).toBe(404);
  });

  it("can't give an admin's friend access to money", async () => {
    const admin = await signedIn("admin");
    expect((await call(invite as Handler, { token: admin.token, body: { email: "x@example.com", role: "finance" } })).status).toBe(403);
    const owner = await signedIn("owner");
    expect((await call(invite as Handler, { token: owner.token, body: { email: "x@example.com", role: "finance" } })).status).toBe(201);
  });

  it("can't make anyone an owner", async () => {
    const { token } = await signedIn();
    expect((await call(invite as Handler, { token, body: { email: "x@example.com", role: "owner" } })).status).toBe(400);
  });
});

describe("team changes", () => {
  async function member(orgId: string, role: string) {
    const userId = newId("usr_");
    await db().insert(schema.users).values({ id: userId, email: `${userId}@example.com` });
    await db().insert(schema.memberships).values({ orgId, userId, role });
    return userId;
  }

  it("can't change your own role", async () => {
    const admin = await signedIn("admin");
    expect((await call(patchMember as Handler, { method: "PATCH", token: admin.token, body: { role: "finance" }, params: { id: admin.userId } })).status).toBe(403);
    // Finance is refused for another reason too, so this is the one only this rule stops.
    expect((await call(patchMember as Handler, { method: "PATCH", token: admin.token, body: { role: "viewer" }, params: { id: admin.userId } })).status).toBe(403);
    const [row] = await db().select({ role: schema.memberships.role }).from(schema.memberships).where(eq(schema.memberships.userId, admin.userId));
    expect(row.role).toBe("admin");
  });

  it("only an owner can grant finance", async () => {
    const admin = await signedIn("admin");
    const target = await member(admin.orgId, "viewer");
    expect((await call(patchMember as Handler, { method: "PATCH", token: admin.token, body: { role: "finance" }, params: { id: target } })).status).toBe(403);
    expect((await call(patchMember as Handler, { method: "PATCH", token: admin.token, body: { role: "admin" }, params: { id: target } })).status).toBe(200);
    const owner = await signedIn("owner");
    const other = await member(owner.orgId, "viewer");
    expect((await call(patchMember as Handler, { method: "PATCH", token: owner.token, body: { role: "finance" }, params: { id: other } })).status).toBe(200);
  });

  it("revokes the API keys a leaver made, not anyone else's", async () => {
    const owner = await signedIn();
    const leaver = await member(owner.orgId, "admin");
    const theirs = await keyFor(owner.orgId, leaver);
    const ours = await keyFor(owner.orgId, owner.userId);
    expect((await call(v1Payments as Handler, { bearer: theirs.secret })).status).toBe(200);
    await call(deleteMember as Handler, { method: "DELETE", token: owner.token, params: { id: leaver } });
    expect((await call(v1Payments as Handler, { bearer: theirs.secret })).status).toBe(401);
    expect((await call(v1Payments as Handler, { bearer: ours.secret })).status).toBe(200);
  });
});

describe("a patch changes only what it names", () => {
  it("doesn't reopen a paused link, or blank its other fields", async () => {
    const { token, orgId } = await signedIn();
    const expiresAt = new Date(Date.now() + 86_400_000);
    const id = await createLink(orgId, { status: "paused", description: "Keep me", successUrl: "https://example.com/thanks", expiresAt });
    expect((await call(patchLink as Handler, { method: "PATCH", token, body: { title: "New title" }, params: { id } })).status).toBe(200);
    const [row] = await db().select().from(schema.paymentLinks).where(eq(schema.paymentLinks.id, id));
    expect(row.title).toBe("New title");
    expect(row.status).toBe("paused");
    expect(row.description).toBe("Keep me");
    expect(row.successUrl).toBe("https://example.com/thanks");
    expect(row.expiresAt?.getTime()).toBe(expiresAt.getTime());
  });

  it("pausing a widget keeps its logo and settings", async () => {
    const { token, orgId } = await signedIn();
    const id = newId("wgt_");
    await db().insert(schema.widgets).values({ id, orgId, name: "Shop", site: "shop.example.com", theme: "dark", accent: "#00EC97", radius: "sharp", receiveAsset: "USDC", logo: "data:image/png;base64,AAAA", displayName: "My shop", collectEmail: true, showBranding: false, acceptedAssets: ["USDC"], presets: [5], success: { mode: "receipt", message: "", url: "" } });
    expect((await call(patchWidget as Handler, { method: "PATCH", token, body: { status: "paused" }, params: { id } })).status).toBe(200);
    const [row] = await db().select().from(schema.widgets).where(eq(schema.widgets.id, id));
    expect(row).toMatchObject({ status: "paused", site: "shop.example.com", theme: "dark", radius: "sharp", logo: "data:image/png;base64,AAAA", displayName: "My shop", collectEmail: true, showBranding: false, presets: [5] });
  });

  it("settings can't point the default destination at another workspace's", async () => {
    const { token, orgId } = await signedIn();
    await call(patchSettings as Handler, { method: "PATCH", token, body: { defaultDestinationId: "dst_someone_elses" } });
    const [org] = await db().select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
    expect(org.defaultDestinationId).toBeNull();
  });
});

describe("a widget's site", () => {
  it("is cut down to a host, and can't inject into a header", () => {
    expect(siteHost.parse("https://Shop.Example.com/page?x=1")).toBe("shop.example.com");
    expect(siteHost.parse("shop.example.com:8443")).toBe("shop.example.com:8443");
    expect(siteHost.parse("")).toBe("");
    for (const bad of ["evil.com; script-src *", "a b.com", "*.evil.com", "evil.com\nX-Header: 1"]) expect(() => siteHost.parse(bad), bad).toThrow();
  });

  it("decides who can frame the checkout", () => {
    expect(cspFor("")).toContain("frame-ancestors *");
    expect(cspFor("shop.example.com")).toContain("frame-ancestors https://shop.example.com http://shop.example.com");
    expect(cspFor("evil.com; script-src *")).toContain("frame-ancestors 'none'");
  });
});

describe("where to go after signing in", () => {
  const ORIGIN = "https://pay.example.com";
  it.each(["/dashboard", "/dashboard/links?x=1", "/invite/abc#y"])("allows %s", (next) => {
    expect(safeNextPath(next, ORIGIN)).toBe(next);
  });
  it.each(["//evil.com", "/\\evil.com", "\\\\evil.com", "https://evil.com", "javascript:alert(1)", "/\t/evil.com"])("refuses %s", (next) => {
    expect(safeNextPath(next, ORIGIN)).toBeNull();
  });
});

describe("request bodies", () => {
  it("are refused past the limit, even with no Content-Length to go on", async () => {
    const chunk = new Uint8Array(64 * 1024).fill(32);
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { sent += 1; if (sent > 100) controller.close(); else controller.enqueue(chunk); } });
    const request = new NextRequest(`${APP_URL}/x`, { method: "POST", headers: { origin: APP_URL, "content-type": "application/json" }, body: stream, duplex: "half" } as ConstructorParameters<typeof NextRequest>[1]);
    const response = await requestLink(request, { params: Promise.resolve({}) });
    expect(response.status).toBe(413);
    expect(sent).toBeLessThan(10);
  });
});

describe("the client's address", () => {
  const withProxy = (hops: string, run: () => void) => {
    Object.assign(process.env, { TRUST_PROXY: "true", TRUSTED_PROXY_HOPS: hops });
    resetEnv();
    try {
      run();
    } finally {
      delete process.env.TRUST_PROXY;
      delete process.env.TRUSTED_PROXY_HOPS;
      resetEnv();
    }
  };
  const ip = (forwarded: string) => clientIp(new NextRequest(`${APP_URL}/x`, { headers: { "x-forwarded-for": forwarded } }));

  it("is what our proxy saw, and a client can't forge it", () => {
    withProxy("1", () => expect(ip("1.1.1.1, 9.9.9.9")).toBe("9.9.9.9"));
    withProxy("2", () => expect(ip("1.1.1.1, 9.9.9.9, 10.0.0.1")).toBe("9.9.9.9"));
  });

  it("groups IPv6 by /64, because one customer holds a whole /64", () => {
    withProxy("1", () => {
      expect(ip("2001:db8:1:2:3:4:5:6")).toBe("2001:db8:1:2::/64");
      expect(ip("2001:db8:1:2:aaaa::1")).toBe("2001:db8:1:2::/64");
    });
  });

  it("isn't trusted without a configured proxy", () => {
    expect(ip("1.1.1.1")).toBeNull();
  });
});

describe("a refused live mode", () => {
  it("stops payments rather than becoming test mode", async () => {
    const { orgId } = await createOrg({ walletAddress: "0x8fd379246834eac74b8419ffda202cf8051f7a03" });
    const id = await createLink(orgId);
    Object.assign(process.env, { PAYMENTS_MODE: "live", LIVE_PAYMENTS_ACK: "i understand" });
    resetEnv();
    try {
      const preview = await call(checkoutPreview as Handler, { params: { sourceId: id }, body: { payAsset: "ETH" } });
      expect(preview.status).toBe(503);
      expect(preview.body.error?.code).toBe("payments_unavailable");
      expect((await call(health as Handler)).body.status).toBe("live_refused");
    } finally {
      process.env.PAYMENTS_MODE = "sim";
      delete process.env.LIVE_PAYMENTS_ACK;
      resetEnv();
    }
  });
});

describe("what a customer's browser can see", () => {
  it("shows a link's public details and nothing internal", async () => {
    const { orgId } = await createOrg({ walletAddress: "0x8fd379246834eac74b8419ffda202cf8051f7a03" });
    const id = await createLink(orgId);
    const { status, body } = await call(checkoutSource as Handler, { params: { sourceId: id } });
    expect(status).toBe(200);
    expect(body.merchant).toBe("Lumen Studio");
    const text = JSON.stringify(body);
    for (const secret of [orgId, "0x8fd379246834eac74b8419ffda202cf8051f7a03", "walletAddress", "holdDays", "orgId"]) expect(text).not.toContain(secret);
  });

  it("hides a deleted link, and an unknown id", async () => {
    const { orgId } = await createOrg();
    const id = await createLink(orgId, { deletedAt: new Date() });
    expect((await call(checkoutSource as Handler, { params: { sourceId: id } })).status).toBe(404);
    expect((await call(checkoutSource as Handler, { params: { sourceId: "lnk_unknown" } })).status).toBe(404);
    expect((await call(checkoutSource as Handler, { params: { sourceId: "../../etc" } })).status).toBe(404);
  });
});

describe("live mode closes the test-only routes", () => {
  const goLive = () => {
    Object.assign(process.env, { PAYMENTS_MODE: "live", ONECLICK_API_KEY: "k", LIVE_PAYMENTS_ACK: "I understand this moves real customer funds", TRUST_PROXY: "true", APP_URL: "https://gateway.example" });
    resetEnv();
  };
  const goRefused = () => {
    goLive();
    delete process.env.LIVE_PAYMENTS_ACK;
    resetEnv();
  };
  const appUrl = process.env.APP_URL;
  const goSim = () => {
    process.env.PAYMENTS_MODE = "sim";
    delete process.env.ONECLICK_API_KEY;
    delete process.env.LIVE_PAYMENTS_ACK;
    delete process.env.TRUST_PROXY;
    if (appUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = appUrl;
    resetEnv();
  };

  const paymentRow = async (live: boolean) => {
    const { orgId } = await createOrg();
    const id = newId("pay_");
    await db().insert(schema.payments).values({ id, orgId, sourceType: "link", sourceId: "lnk_x", sourceName: "x", state: "awaiting_deposit", payAsset: "ETH", receiveAsset: "USDC", usd: "1", receiveBase: "1", payer: "x", settlementMode: "balance", recipient: "x", recipientType: "INTENTS", depositAddress: `sim_${id}`, live });
    return id;
  };

  it("has no 'simulate a payment' route, even for a payment that exists", async () => {
    const id = await paymentRow(false);
    goLive();
    try {
      expect((await call(simPay as Handler, { params: { id }, origin: "https://gateway.example", body: { scenario: "pay" } })).status).toBe(404);
    } finally {
      goSim();
    }
  });

  it("has no refund simulation when live or refused, and none for another workspace", async () => {
    const { token, orgId, userId } = await signedIn();
    const id = newId("rfd_");
    const paymentId = await paymentRow(false);
    await db().insert(schema.refunds).values({ id, orgId, paymentId, kind: "route", state: "awaiting_deposit", asset: "USDC", amountBase: "1", payAsset: "ETH", usd: "1", recipient: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045", requestedBy: userId, depositAddress: "sim_x", live: false });
    const stranger = await signedIn();
    expect((await call(simRefund as Handler, { token: stranger.token, params: { id }, body: {} })).status).toBe(404);
    for (const go of [goLive, goRefused]) {
      go();
      try {
        expect((await call(simRefund as Handler, { token, params: { id }, origin: "https://gateway.example", body: {} })).status).toBe(404);
      } finally {
        goSim();
      }
    }
  });

  it("has no simulate route when refused, which an operator believes is live", async () => {
    const id = await paymentRow(false);
    goRefused();
    try {
      expect((await call(simPay as Handler, { params: { id }, origin: "https://gateway.example", body: { scenario: "pay" } })).status).toBe(404);
    } finally {
      goSim();
    }
  });

  it("can't fake a real payment from test mode", async () => {
    const id = await paymentRow(true);
    expect((await call(simPay as Handler, { params: { id }, body: { scenario: "pay" } })).status).toBe(404);
  });

  // Same-origin checks read APP_URL, so these send the Origin the live config expects.
  it.each([["live", goLive], ["refused live, which an operator believes is live", goRefused]] as const)("has no sample data when %s", async (_, go) => {
    const { token } = await signedIn();
    go();
    try {
      expect((await call(sampleData as Handler, { token, origin: "https://gateway.example", body: { action: "load" } })).status).toBe(404);
    } finally {
      goSim();
    }
  });
});

describe("API keys", () => {
  it("are required, and a wrong or revoked one is refused", async () => {
    const { orgId, userId } = await createOrg();
    const { secret, id } = await keyFor(orgId, userId);
    expect((await call(v1Payments as Handler)).status).toBe(401);
    expect((await call(v1Payments as Handler, { bearer: "gw_test_wrongwrongwrongwrongwrongwrong" })).status).toBe(401);
    expect((await call(v1Payments as Handler, { bearer: secret })).status).toBe(200);
    await db().update(schema.apiKeys).set({ revokedAt: new Date() }).where(eq(schema.apiKeys.id, id));
    expect((await call(v1Payments as Handler, { bearer: secret })).status).toBe(401);
  });

  it("show only their own workspace", async () => {
    const mine = await createOrg();
    const theirs = await createOrg();
    const key = await keyFor(mine.orgId, mine.userId);
    const theirLink = await createLink(theirs.orgId);
    const paymentId = newId("pay_");
    await db().insert(schema.payments).values({ id: paymentId, orgId: theirs.orgId, sourceType: "link", sourceId: theirLink, sourceName: "x", state: "settled", payAsset: "ETH", receiveAsset: "USDC", usd: "1", receiveBase: "1", payer: "x", settlementMode: "balance", recipient: "x", recipientType: "INTENTS" });
    expect(JSON.stringify((await call(v1Links as Handler, { bearer: key.secret })).body)).not.toContain(theirLink);
    expect((await call(v1Payment as Handler, { bearer: key.secret, params: { id: paymentId } })).status).toBe(404);
    expect(JSON.stringify((await call(v1Payments as Handler, { bearer: key.secret })).body)).not.toContain(paymentId);
  });

  it("are stored only as a hash, and shown once", async () => {
    const { token, orgId } = await signedIn();
    const { body } = await call(createApiKey as Handler, { token, body: { label: "Server" } });
    expect(body.secret).toMatch(/^gw_test_/);
    const [row] = await db().select().from(schema.apiKeys).where(eq(schema.apiKeys.orgId, orgId));
    expect(JSON.stringify(row)).not.toContain(body.secret as string);
    expect((await call(getState as Handler, { token })).body.settings).not.toHaveProperty("apiKeys.0.secret");
  });

  it("replay a create with the same Idempotency-Key, and refuse it with a different body", async () => {
    const { orgId, userId } = await createOrg();
    const key = await keyFor(orgId, userId);
    const headers = { "idempotency-key": "order-1" };
    const first = await call(v1CreateLink as Handler, { bearer: key.secret, body: LINK, headers, origin: null });
    expect(first.status).toBe(201);
    const second = await call(v1CreateLink as Handler, { bearer: key.secret, body: LINK, headers, origin: null });
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id);
    expect((await db().select().from(schema.paymentLinks).where(eq(schema.paymentLinks.orgId, orgId))).length).toBe(1);
    expect((await call(v1CreateLink as Handler, { bearer: key.secret, body: { ...LINK, amount: 99 }, headers, origin: null })).status).toBe(409);
  });

  it("let the caller retry a key whose request failed", async () => {
    const { orgId, userId } = await createOrg();
    const key = await keyFor(orgId, userId);
    const headers = { "idempotency-key": "order-2" };
    expect((await call(v1CreateLink as Handler, { bearer: key.secret, body: { title: "" }, headers, origin: null })).status).toBe(400);
    expect((await call(v1CreateLink as Handler, { bearer: key.secret, body: { title: "" }, headers, origin: null })).status).toBe(400);
  });
});

describe("input that could become script", () => {
  it.each(["javascript:alert(1)", "data:text/html,x", "ftp://example.com"])("refuses %s as a success URL", async (successUrl) => {
    const { token } = await signedIn();
    expect((await call(postLink as Handler, { token, body: { ...LINK, successUrl } })).status).toBe(400);
  });
});

describe("webhook URLs", () => {
  it.each(["http://example.com/h", "https://localhost/h", "https://127.0.0.1/h", "https://169.254.169.254/latest/meta-data", "https://10.0.0.5/h", "https://[::1]/h", "https://metadata.internal/h"])("refuses %s", async (url) => {
    const { token } = await signedIn();
    expect((await call(postWebhook as Handler, { token, body: { url, events: ["payment.settled"] } })).body.error?.code).toBe("webhook_url_invalid");
  });

  it("stores the signing secret encrypted, and shows it once", async () => {
    const { token, orgId } = await signedIn();
    const { body } = await call(postWebhook as Handler, { token, body: { url: "https://example.com/h", events: ["payment.settled"] } });
    expect(body.secret).toMatch(/^whsec_/);
    const [row] = await db().select().from(schema.webhooks).where(eq(schema.webhooks.orgId, orgId));
    expect(row.secretEnc).not.toContain(body.secret as string);
  });
});
