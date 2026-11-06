import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { Client } from "pg";
import { closeDb, db, schema } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { resetEnv } from "@/server/env";
import { newId } from "@/server/ids";
import { resetTokenCache } from "@/server/payments/tokens";

export const APP_URL = "http://localhost:3000";

/** A fresh, migrated database for one test file. Runs the same SQL that production runs. */
export async function freshDatabase() {
  const server = process.env.TEST_POSTGRES_URL;
  if (!server) throw new Error("Global Postgres setup did not run");
  const name = `t_${randomBytes(6).toString("hex")}`;
  const client = new Client({ connectionString: `${server}/postgres` });
  await client.connect();
  await client.query(`create database ${name}`);
  await client.end();
  const url = `${server}/${name}`;
  await runMigrations(url);
  Object.assign(process.env, { DATABASE_URL: url, APP_URL, SECRET_KEY: "test-secret-key-test-secret-key-test", PAYMENTS_MODE: "sim", EMAIL_PROVIDER: "console", NODE_ENV: "production" });
  resetEnv();
  resetTokenCache();
  return { url, close: closeDb };
}

export interface OrgFixture {
  orgId: string;
  userId: string;
  email: string;
}

export const WALLET = "0x8fd379246834eac74b8419ffda202cf8051f7a03";
/** Hardhat test key for the wallet above's sibling. Public on purpose; never holds anything. */
export const WALLET_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

export async function createOrg(overrides: Partial<typeof schema.organizations.$inferInsert> = {}, role = "owner"): Promise<OrgFixture> {
  const orgId = newId("org_");
  const userId = newId("usr_");
  const email = `${userId}@example.com`;
  await db().insert(schema.users).values({ id: userId, email });
  await db().insert(schema.organizations).values({
    id: orgId,
    businessName: "Lumen Studio",
    receiveAsset: "USDC",
    branding: { accent: "#00EC97", supportEmail: email, statementName: "Lumen" },
    notifications: { settled: true, processing: false, refunded: true, expired: false, links: true },
    termsVersion: "test",
    termsAcceptedAt: new Date(),
    ...overrides,
  });
  await db().insert(schema.memberships).values({ orgId, userId, role });
  return { orgId, userId, email };
}

export async function createLink(orgId: string, overrides: Partial<typeof schema.paymentLinks.$inferInsert> = {}) {
  const id = newId("lnk_");
  await db().insert(schema.paymentLinks).values({ id, orgId, title: "Deposit", amountUsd: "50.00", receiveAsset: "USDC", ...overrides });
  return id;
}

export const paymentById = async (id: string) => (await db().select().from(schema.payments).where(eq(schema.payments.id, id)).limit(1))[0];
