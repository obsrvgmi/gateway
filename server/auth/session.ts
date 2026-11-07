import "server-only";
import { and, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { hashSecret, newSecret } from "../ids";
import { isRole, type Role } from "./rbac";

export const SESSION_COOKIE = "gw_session";
const SESSION_DAYS = 30;
const DAY = 86_400_000;

export interface Principal {
  tokenHash: string;
  user: { id: string; email: string; name: string };
  orgId: string | null;
  role: Role | null;
}

export async function createSession(userId: string, orgId: string | null) {
  const token = newSecret();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY);
  await db().insert(schema.sessions).values({ tokenHash: hashSecret(token), userId, orgId, expiresAt });
  return { token, expiresAt };
}

export async function destroySession(token: string) {
  await db().delete(schema.sessions).where(eq(schema.sessions.tokenHash, hashSecret(token)));
}

/** The signed-in person and their role in the session's workspace, re-read on every request. */
export async function readSession(token: string | undefined): Promise<Principal | null> {
  if (!token) return null;
  const tokenHash = hashSecret(token);
  const [row] = await db()
    .select({ session: schema.sessions, user: schema.users })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.tokenHash, tokenHash), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;

  let role: Role | null = null;
  let orgId = row.session.orgId;
  if (orgId) {
    const [membership] = await db()
      .select({ role: schema.memberships.role })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.orgId, orgId), eq(schema.memberships.userId, row.user.id)))
      .limit(1);
    // Removed from the team: the session keeps the person signed in but loses the workspace at once.
    if (membership && isRole(membership.role)) role = membership.role;
    else orgId = null;
  }

  // Sliding expiry, written at most hourly so reads stay cheap.
  if (Date.now() - row.session.lastSeenAt.getTime() > 3_600_000) {
    await db()
      .update(schema.sessions)
      .set({ lastSeenAt: new Date(), expiresAt: sql`now() + interval '${sql.raw(String(SESSION_DAYS))} days'` })
      .where(eq(schema.sessions.tokenHash, tokenHash));
  }

  return { tokenHash, user: { id: row.user.id, email: row.user.email, name: row.user.name }, orgId, role };
}
