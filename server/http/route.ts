import "server-only";
import { isIPv6 } from "node:net";
import { unstable_rethrow } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type z } from "zod";
import { can, type Permission, type Role } from "../auth/rbac";
import { readSession, SESSION_COOKIE, type Principal } from "../auth/session";
import { env } from "../env";
import { log } from "../log";
import { badRequest, forbidden, HttpError, unauthorized } from "./errors";

export type RouteParams = Promise<Record<string, string | string[] | undefined>>;
type NextHandler = (request: NextRequest, context: { params: RouteParams }) => Promise<Response>;

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, { ...init, headers: { "Cache-Control": "no-store", ...init?.headers } });
}

function toResponse(error: unknown, request: NextRequest) {
  if (error instanceof HttpError) return json({ error: { code: error.code, message: error.message, ...error.extra } }, { status: error.status });
  if (error instanceof ZodError) return json({ error: { code: "invalid_input", message: error.issues[0]?.message ?? "Invalid input.", issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) } }, { status: 400 });
  log("error", "unhandled route error", { path: request.nextUrl.pathname, method: request.method, error });
  return json({ error: { code: "internal", message: "Something went wrong. Please try again." } }, { status: 500 });
}

/** Handlers that wrap an unexpected failure in a JSON response instead of an HTML error page. */
export function publicRoute(handler: (request: NextRequest, params: Record<string, string>) => Promise<Response>): NextHandler {
  return async (request, context) => {
    try {
      return await handler(request, (await context.params) as Record<string, string>);
    } catch (error) {
      // Next signals "this route is dynamic" by throwing. That isn't a failure, and must reach Next.
      unstable_rethrow(error);
      return toResponse(error, request);
    }
  };
}

/**
 * Cookies go with cross-site requests in some cases, so a mutating request must prove it came from
 * our own pages. API-key routes don't use cookies and don't need this.
 */
export function assertSameOrigin(request: NextRequest) {
  if (!MUTATING.has(request.method)) return;
  const origin = request.headers.get("origin");
  const expected = new URL(env().APP_URL).origin;
  if (origin !== expected) throw forbidden("Request origin not allowed.");
}

export interface SessionContext {
  principal: Principal;
  params: Record<string, string>;
  ip: string | null;
}

export interface OrgContext extends SessionContext {
  orgId: string;
  role: Role;
  userId: string;
}

/** Rate limits group IPv6 by /64, because one customer's connection usually holds a whole /64. */
function bucketAddress(address: string) {
  if (!isIPv6(address)) return address;
  const [head, tail = ""] = address.split("::");
  const front = head ? head.split(":") : [];
  const back = tail ? tail.split(":") : [];
  return `${[...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back].slice(0, 4).join(":")}::/64`;
}

/**
 * The address our own proxy saw. Each proxy appends to X-Forwarded-For, so counting back the known
 * number of hops gets an address a client can't forge. Without a configured proxy there's no address to
 * trust at all, which is why live mode requires one.
 */
export function clientIp(request: NextRequest) {
  const { TRUST_PROXY, TRUSTED_PROXY_HOPS } = env();
  if (!TRUST_PROXY) return null;
  const hops = request.headers.get("x-forwarded-for")?.split(",").map((hop) => hop.trim()).filter(Boolean);
  const address = hops?.[hops.length - TRUSTED_PROXY_HOPS];
  return address ? bucketAddress(address) : null;
}

async function principalOf(request: NextRequest) {
  const principal = await readSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!principal) throw unauthorized();
  return principal;
}

/** Signed in, workspace or not: login-adjacent routes such as onboarding. */
export function userRoute(handler: (request: NextRequest, context: SessionContext) => Promise<Response>): NextHandler {
  return publicRoute(async (request, params) => {
    assertSameOrigin(request);
    return handler(request, { principal: await principalOf(request), params, ip: clientIp(request) });
  });
}

/** Signed in with `permission` in the session's workspace. Every query must be scoped to `orgId`. */
export function orgRoute(permission: Permission, handler: (request: NextRequest, context: OrgContext) => Promise<Response>): NextHandler {
  return publicRoute(async (request, params) => {
    assertSameOrigin(request);
    const principal = await principalOf(request);
    if (!principal.orgId || !principal.role) throw forbidden("Finish setting up your workspace first.");
    if (!can(principal.role, permission)) throw forbidden();
    return handler(request, { principal, params, ip: clientIp(request), orgId: principal.orgId, role: principal.role, userId: principal.user.id });
  });
}

const MAX_BODY_BYTES = 256 * 1024;

/**
 * Counts bytes as they arrive. `Content-Length` is only a claim, and a chunked body has none, so
 * trusting it would let anyone fill the server's memory. This cap leaves room for a logo data URL.
 */
export async function readBody(request: NextRequest): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new HttpError(413, "too_large", "Request is too large.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Parses a JSON body against a schema. */
export async function readJson<T extends z.ZodType>(request: NextRequest, schema: T): Promise<z.output<T>> {
  const text = await readBody(request);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw badRequest("Request body must be JSON.");
  }
  return schema.parse(body);
}
