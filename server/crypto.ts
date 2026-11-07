import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const keyFrom = (secret: string) => createHash("sha256").update(`gateway-encryption:${secret}`).digest();

/** AES-256-GCM. The output carries its IV and tag, and any tampering fails on decrypt. */
export function encrypt(plain: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

export function decrypt(sealed: string, secret: string) {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("Unrecognised ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

/** The webhook signature header value: `t=<unix seconds>,v1=<hex hmac of "t.body">`. */
export function signWebhook(body: string, secret: string, timestampSeconds: number) {
  const mac = createHmac("sha256", secret).update(`${timestampSeconds}.${body}`).digest("hex");
  return `t=${timestampSeconds},v1=${mac}`;
}

export function verifyWebhookSignature(header: string, body: string, secret: string, nowSeconds: number, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(",").map((part) => part.split("=") as [string, string]));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || !parts.v1) return false;
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
  const given = Buffer.from(parts.v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
