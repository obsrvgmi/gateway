import { createHash, randomBytes, randomInt } from "node:crypto";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A public id like `lnk_a81k…`. Long enough that links can't be enumerated. */
export function newId(prefix: string, length = 20) {
  let out = "";
  for (let i = 0; i < length; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return `${prefix}${out}`;
}

/** A secret with 256 bits of entropy, for sessions, login links, invites and API keys. */
export function newSecret() {
  return randomBytes(32).toString("base64url");
}

/** Stored instead of the secret. High entropy input, so a plain hash is enough and lookups stay exact. */
export function hashSecret(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}
