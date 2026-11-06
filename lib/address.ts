import { sha256 } from "@noble/hashes/sha256";
import { base58, bech32, bech32m } from "@scure/base";
import { isAddress } from "viem";
import type { AddressKind } from "./assets";

const NEAR_NAMED = /^(?=.{2,64}$)[a-z0-9]+([-_][a-z0-9]+)*(\.[a-z0-9]+([-_][a-z0-9]+)*)*$/;
const NEAR_IMPLICIT = /^[0-9a-f]{64}$/;

/** base58check: payload then a 4-byte double-SHA-256 checksum. Returns the payload, or null. */
function base58check(value: string): Uint8Array | null {
  try {
    const bytes = base58.decode(value);
    if (bytes.length < 5) return null;
    const payload = bytes.slice(0, -4);
    const check = sha256(sha256(payload)).slice(0, 4);
    return check.every((byte, index) => byte === bytes[bytes.length - 4 + index]) ? payload : null;
  } catch {
    return null;
  }
}

function isBitcoinAddress(value: string) {
  if (/^bc1/i.test(value)) {
    try {
      const lower = value.toLowerCase();
      const decoded = lower.startsWith("bc1q") ? bech32.decode(lower as `${string}1${string}`) : bech32m.decode(lower as `${string}1${string}`);
      return decoded.prefix === "bc";
    } catch {
      return false;
    }
  }
  const payload = base58check(value);
  return payload?.length === 21 && (payload[0] === 0x00 || payload[0] === 0x05);
}

function isSolanaAddress(value: string) {
  try {
    return base58.decode(value).length === 32;
  } catch {
    return false;
  }
}

function isTronAddress(value: string) {
  if (!value.startsWith("T")) return false;
  const payload = base58check(value);
  return payload?.length === 21 && payload[0] === 0x41;
}

/** Format and checksum only. It can't prove an address is controlled by anyone. */
export function isValidAddress(kind: AddressKind, value: string): boolean {
  switch (kind) {
    case "evm":
      return isAddress(value);
    case "btc":
      return isBitcoinAddress(value);
    case "sol":
      return isSolanaAddress(value);
    case "tron":
      return isTronAddress(value);
    case "near":
      return NEAR_IMPLICIT.test(value) || NEAR_NAMED.test(value);
  }
}

/** EVM addresses compare case-insensitively; the others are case-sensitive and stay as typed. */
export function normalizeAddress(kind: AddressKind, value: string) {
  const trimmed = value.trim();
  return kind === "evm" ? trimmed.toLowerCase() : trimmed;
}

const LABEL: Record<AddressKind, string> = { evm: "an EVM", btc: "a Bitcoin", sol: "a Solana", near: "a NEAR", tron: "a Tron" };
export const addressError = (kind: AddressKind) => `Enter ${LABEL[kind]} wallet address.`;
