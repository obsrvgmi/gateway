import "server-only";
import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { db, schema } from "../db";
import { hashSecret } from "../ids";
import { conflict, HttpError, unauthorized } from "./errors";
import { rateLimit } from "./rate-limit";
import { json, publicRoute } from "./route";

export interface KeyContext {
  orgId: string;
  keyId: string;
  params: Record<string, string>;
}

const KEY_FORMAT = /^gw_(live|test)_[A-Za-z0-9_-]{20,}$/;

async function authenticate(request: NextRequest) {
  const header = request.headers.get("authorization") ?? "";
  const key = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!KEY_FORMAT.test(key)) throw unauthorized("Send your API key as `Authorization: Bearer gw_...`.");
  const [row] = await db().select({ id: schema.apiKeys.id, orgId: schema.apiKeys.orgId, lastUsedAt: schema.apiKeys.lastUsedAt }).from(schema.apiKeys).where(and(eq(schema.apiKeys.keyHash, hashSecret(key)), isNull(schema.apiKeys.revokedAt))).limit(1);
  if (!row) throw unauthorized("That API key isn't valid.");
  await rateLimit(`api:${row.id}`, 600, 60);
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) await db().update(schema.apiKeys).set({ lastUsedAt: sql`now()` }).where(eq(schema.apiKeys.id, row.id));
  return row;
}

/** Keys don't use cookies, so these routes need no Origin check. Every query must be scoped to `orgId`. */
export function apiRoute(handler: (request: NextRequest, context: KeyContext) => Promise<Response>) {
  return publicRoute(async (request, params) => {
    const key = await authenticate(request);
    return handler(request, { orgId: key.orgId, keyId: key.id, params });
  });
}

/**
 * Stores the first response under the caller's `Idempotency-Key`, so a retried create doesn't make a
 * second one. The same key with a different body is an error, not a replay.
 */
export function idempotentApiRoute(handler: (request: NextRequest, context: KeyContext, body: unknown) => Promise<{ status: number; body: unknown }>) {
  return apiRoute(async (request, context) => {
    const raw = await request.text();
    if (raw.length > 256 * 1024) throw new HttpError(400, "bad_request", "Request is too large.");
    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      throw new HttpError(400, "bad_request", "Request body must be JSON.");
    }
    const key = request.headers.get("idempotency-key");
    if (!key) {
      const result = await handler(request, context, body);
      return json(result.body, { status: result.status });
    }
    if (key.length > 200) throw new HttpError(400, "bad_request", "Idempotency-Key is too long.");
    const requestHash = createHash("sha256").update(`${request.method} ${request.nextUrl.pathname} ${raw}`).digest("hex");
    const claimed = await db().insert(schema.idempotencyKeys).values({ orgId: context.orgId, key, requestHash }).onConflictDoNothing().returning({ key: schema.idempotencyKeys.key });
    if (!claimed.length) {
      const [existing] = await db().select().from(schema.idempotencyKeys).where(and(eq(schema.idempotencyKeys.orgId, context.orgId), eq(schema.idempotencyKeys.key, key))).limit(1);
      if (existing.requestHash !== requestHash) throw conflict("This Idempotency-Key was used with a different request.", "idempotency_mismatch");
      if (existing.status === null) throw conflict("A request with this Idempotency-Key is still in progress.", "idempotency_in_progress");
      return json(existing.response, { status: existing.status, headers: { "Idempotent-Replay": "true" } });
    }
    try {
      const result = await handler(request, context, body);
      await db().update(schema.idempotencyKeys).set({ status: result.status, response: result.body }).where(and(eq(schema.idempotencyKeys.orgId, context.orgId), eq(schema.idempotencyKeys.key, key)));
      return json(result.body, { status: result.status });
    } catch (error) {
      // A failed request did nothing, so the caller may retry it with the same key.
      await db().delete(schema.idempotencyKeys).where(and(eq(schema.idempotencyKeys.orgId, context.orgId), eq(schema.idempotencyKeys.key, key)));
      throw error;
    }
  });
}
