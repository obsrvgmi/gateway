import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { LOGIN_NONCE_COOKIE, sessionCookie } from "@/server/auth/cookie";
import { createSession } from "@/server/auth/session";
import { db, schema } from "@/server/db";
import { conflict, unauthorized } from "@/server/http/errors";
import { assertSameOrigin, json, publicRoute, readJson } from "@/server/http/route";
import { hashSecret, newId } from "@/server/ids";

const INVALID = "This sign-in link has expired or was already used.";
const mask = (email: string) => `${email[0]}***@${email.split("@")[1]}`;

/**
 * POST, not GET, because mail scanners follow links and would burn a one-time token.
 * The page at /login/verify posts here from the browser.
 *
 * A link opened in the browser that asked for it continues. Anywhere else, the person must confirm who
 * they're about to sign in as: otherwise an attacker could send someone their own link, and the victim
 * would be working in the attacker's workspace, creating links that pay the attacker's wallet.
 */
export const POST = publicRoute(async (request) => {
  assertSameOrigin(request);
  const { token, confirmed } = await readJson(request, z.object({ token: z.string().min(16).max(200), confirmed: z.boolean().optional() }));
  const tokenHash = hashSecret(token);
  const usable = and(eq(schema.loginTokens.tokenHash, tokenHash), isNull(schema.loginTokens.usedAt), gt(schema.loginTokens.expiresAt, new Date()));

  const [pending] = await db().select().from(schema.loginTokens).where(usable).limit(1);
  if (!pending) throw unauthorized(INVALID);
  const nonce = request.cookies.get(LOGIN_NONCE_COOKIE)?.value;
  const sameBrowser = Boolean(nonce && pending.nonceHash && hashSecret(nonce) === pending.nonceHash);
  if (!sameBrowser && !confirmed) throw conflict("Confirm which account you're signing in to.", "confirm_needed", { email: mask(pending.email) });

  // One atomic update: two requests with the same link can't both win.
  const [claimed] = await db().update(schema.loginTokens).set({ usedAt: new Date() }).where(usable).returning({ email: schema.loginTokens.email });
  if (!claimed) throw unauthorized(INVALID);

  const [user] = await db()
    .insert(schema.users)
    .values({ id: newId("usr_"), email: claimed.email, lastLoginAt: new Date() })
    .onConflictDoUpdate({ target: schema.users.email, set: { lastLoginAt: new Date() } })
    .returning();

  const [membership] = await db()
    .select({ orgId: schema.memberships.orgId })
    .from(schema.memberships)
    .where(eq(schema.memberships.userId, user.id))
    .orderBy(asc(schema.memberships.createdAt))
    .limit(1);

  const session = await createSession(user.id, membership?.orgId ?? null);
  const response = json({ ok: true, needsOnboarding: !membership });
  response.cookies.set(sessionCookie(session.token, session.expiresAt));
  response.cookies.delete(LOGIN_NONCE_COOKIE);
  return response;
});
