import "server-only";
import { z } from "zod";

/** The exact phrase an operator must set before real money can move. */
export const LIVE_ACK_PHRASE = "I understand this moves real customer funds";

const optional = z.string().trim().min(1).optional().catch(undefined);

const schema = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  /** At least 32 random characters. Encrypts webhook secrets and keys the audit of stored tokens. */
  SECRET_KEY: z.string().min(32),
  /** The client address is the last X-Forwarded-For hop. Only set this behind a proxy that appends it. */
  TRUST_PROXY: z.stringbool().default(false),
  /** How many proxies append to X-Forwarded-For in front of the app. A wrong number buckets everyone together, or trusts a forged address. */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).max(5).default(1),

  EMAIL_PROVIDER: z.enum(["console", "resend", "file"]).default("console"),
  EMAIL_FROM: z.string().default("Gateway <no-reply@localhost>"),
  EMAIL_FILE: optional,
  RESEND_API_KEY: optional,

  PAYMENTS_MODE: z.enum(["sim", "live"]).default("sim"),
  LIVE_PAYMENTS_ACK: optional,
  ONECLICK_BASE_URL: z.string().url().default("https://1click.chaindefuser.com"),
  ONECLICK_API_KEY: optional,
  APP_FEE_BPS: z.coerce.number().int().min(0).max(250).default(0),
  APP_FEE_RECIPIENT: optional,
  NEAR_RPC_URL: z.string().url().default("https://rpc.mainnet.near.org"),
  /** Set only after a live canary proves Intents recipients escape NEAR's origin-to-origin minimums. */
  MINIMUMS_EXEMPT_INTENTS_RECIPIENT: z.stringbool().default(false),

  /** Tests and local work only: lets webhooks reach http and private addresses. */
  WEBHOOKS_ALLOW_PRIVATE: z.stringbool().default(false),
  /** Comma-separated ISO country codes refused at checkout, read from GEO_COUNTRY_HEADER. */
  BLOCKED_COUNTRIES: z.string().default("CU,IR,KP,SY"),
  /** Set by the CDN in front of the app, such as `cf-ipcountry`. Without it, nothing is geo-blocked. */
  GEO_COUNTRY_HEADER: optional,

  MIN_PAYMENT_USD: z.coerce.number().positive().default(1),
  MAX_PAYMENT_USD: z.coerce.number().positive().default(1_000_000),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Parsed on first use, so `next build` needs no secrets. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  // A plain Error, because route handlers answer a ZodError as the caller's own bad input, names and all.
  if (!parsed.success) throw new Error(`Invalid server settings: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`);
  cached = parsed.data;
  return cached;
}

/** For tests that change the environment between cases. */
export function resetEnv() {
  cached = null;
}

/** Why live payments can't run, or an empty list when every gate passes. */
export function liveGateFailures(config: Env = env()): string[] {
  const failures: string[] = [];
  if (!config.ONECLICK_API_KEY) failures.push("ONECLICK_API_KEY is not set");
  if (config.LIVE_PAYMENTS_ACK !== LIVE_ACK_PHRASE) failures.push("LIVE_PAYMENTS_ACK does not match the required phrase");
  if (config.APP_FEE_BPS > 0 && !config.APP_FEE_RECIPIENT) failures.push("APP_FEE_BPS is set without APP_FEE_RECIPIENT");
  if (!config.TRUST_PROXY) failures.push("TRUST_PROXY is off, so per-address rate limits can't run");
  if (!config.APP_URL.startsWith("https://")) failures.push("APP_URL must be https");
  // Next fixes this at build time, so it reports what was built. A test build's browser trusts a key the server offers.
  if (process.env.NEXT_PUBLIC_TEST_BUILD === "true") failures.push("This is a test build. Rebuild without NEXT_PUBLIC_TEST_BUILD");
  return failures;
}

/**
 * Asked for live, and a gate failed. Payments stop rather than quietly becoming test mode: a typo must
 * not leave a site taking simulated payments that fire signed webhooks while its operator thinks it's live.
 */
export const liveRefused = (config: Env = env()) => config.PAYMENTS_MODE === "live" && liveGateFailures(config).length > 0;

/** Real money only when asked for and every gate passes. Anything else is test mode. */
export function paymentsMode(config: Env = env()): "sim" | "live" {
  return config.PAYMENTS_MODE === "live" && liveGateFailures(config).length === 0 ? "live" : "sim";
}
