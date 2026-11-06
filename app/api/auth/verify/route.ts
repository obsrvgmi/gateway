import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { sessionCookie } from "@/server/auth/cookie";
import { createSession } from "@/server/auth/session";
import { db, schema } from "@/server/db";
import { unauthorized } from "@/server/http/errors";
import { assertSameOrigin, json, publicRoute, readJson } from "@/server/http/route";
import { hashSecret, newId } from "@/server/ids";

/**
 * POST, not GET, because mail scanners follow links and would burn a one-time token.
 * The page at /login/verify posts here from the browser.
 */
export const POST = publicRoute(async (request) => {
  assertSameOrigin(request);
  const { token } = await readJson(request, z.object({ token: z.string().min(16).max(200) }));

  // One atomic update: two requests with the same link can't both win.
  const [claimed] = await db()
    .update(schema.loginTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(schema.loginTokens.tokenHash, hashSecret(token)), isNull(schema.loginTokens.usedAt), gt(schema.loginTokens.expiresAt, new Date())))
    .returning({ email: schema.loginTokens.email });
  if (!claimed) throw unauthorized("This sign-in link has expired or was already used.");

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
  return response;
});
