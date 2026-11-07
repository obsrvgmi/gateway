import { describe, expect, it } from "vitest";
import { recoverMessageAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { checkTransferPayload, encodeErc191Signature, stableStringify, verifyQuoteSignature, type SignedQuote } from "@/lib/intents";
import dry from "./fixtures/quote-dry.json";
import generated from "./fixtures/generate-intent.json";
import live from "./fixtures/quote-live.json";
import payout from "./fixtures/quote-payout-live.json";

const FUTURE = Date.parse("2026-11-07T00:00:00Z");

describe("verifyQuoteSignature, against real 1Click responses", () => {
  it.each([["dry", dry], ["live", live], ["payout", payout]])("accepts the %s quote", (_, response) => {
    expect(verifyQuoteSignature(response as unknown as SignedQuote)).toBe(true);
  });

  const tamper = (fn: (copy: SignedQuote) => void) => {
    const copy = structuredClone(live) as unknown as SignedQuote;
    fn(copy);
    return verifyQuoteSignature(copy);
  };

  it("rejects a changed deposit address", () => {
    expect(tamper((q) => { q.quote.depositAddress = "0x000000000000000000000000000000000000dEaD"; })).toBe(false);
  });
  it("rejects a changed recipient", () => {
    expect(tamper((q) => { q.quoteRequest.recipient = "0x000000000000000000000000000000000000dead"; })).toBe(false);
  });
  it("rejects a changed refund address", () => {
    expect(tamper((q) => { q.quoteRequest.refundTo = "0x000000000000000000000000000000000000dEaD"; })).toBe(false);
  });
  it("rejects a changed amount", () => {
    expect(tamper((q) => { q.quote.minAmountIn = "1"; })).toBe(false);
  });
  it("rejects a changed timestamp", () => {
    expect(tamper((q) => { q.timestamp = "2030-01-01T00:00:00.000Z"; })).toBe(false);
  });
  it("rejects a signature made by another key", () => {
    expect(verifyQuoteSignature(live as unknown as SignedQuote, "ed25519:11111111111111111111111111111111")).toBe(false);
  });
  it("rejects a malformed signature rather than throwing", () => {
    expect(tamper((q) => { q.signature = "not-a-signature"; })).toBe(false);
  });
});

describe("stableStringify", () => {
  it("sorts keys, drops undefined and matches JSON otherwise", () => {
    expect(stableStringify({ b: 1, a: { d: [1, "x", null], c: undefined } })).toBe('{"a":{"d":[1,"x",null]},"b":1}');
  });
});

describe("checkTransferPayload", () => {
  const { payload } = generated.intent;
  const usdc = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
  const expected = {
    signer: "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
    receiver: payout.quote.depositAddress,
    assetId: usdc,
    amount: "50000000",
  };
  const edit = (fn: (parsed: Record<string, never> & { intents: Record<string, unknown>[] }) => void) => {
    const parsed = JSON.parse(payload);
    fn(parsed);
    return JSON.stringify(parsed);
  };

  it("accepts the real payload 1Click generated", () => {
    expect(checkTransferPayload(payload, expected, FUTURE)).toBeNull();
  });
  it("matches the signer case-insensitively", () => {
    expect(checkTransferPayload(payload, { ...expected, signer: expected.signer.toUpperCase().replace("0X", "0x") }, FUTURE)).toBeNull();
  });

  it.each<[string, Parameters<typeof edit>[0]]>([
    ["the wrong contract", (p) => { Object.assign(p, { verifying_contract: "evil.near" }); }],
    ["the wrong signer", (p) => { Object.assign(p, { signer_id: "0x0000000000000000000000000000000000000001" }); }],
    ["an added intent", (p) => { p.intents.push({ intent: "add_public_key", public_key: "ed25519:x" }); }],
    ["a key grant instead of a transfer", (p) => { p.intents[0] = { intent: "add_public_key", public_key: "ed25519:x" }; }],
    ["a different receiver", (p) => { p.intents[0].receiver_id = "attacker.near"; }],
    ["a second token", (p) => { (p.intents[0].tokens as Record<string, string>)["nep141:wrap.near"] = "1"; }],
    ["a different token", (p) => { p.intents[0].tokens = { "nep141:wrap.near": "50000000" }; }],
    ["a larger amount", (p) => { p.intents[0].tokens = { [usdc]: "50000001" }; }],
    ["an unexpected field", (p) => { p.intents[0].memo = "x"; }],
    ["an expired deadline", (p) => { Object.assign(p, { deadline: "2020-01-01T00:00:00Z" }); }],
    ["no intents", (p) => { p.intents.length = 0; }],
  ])("refuses %s", (_, fn) => {
    expect(checkTransferPayload(edit(fn), expected, FUTURE)).not.toBeNull();
  });

  it("refuses another kind of action, even with the right address and amount", () => {
    const parsed = JSON.parse(payload);
    parsed.intents[0].intent = "ft_withdraw";
    expect(checkTransferPayload(JSON.stringify(parsed), expected, FUTURE)).toMatch(/not a transfer/);
  });

  it("refuses text that isn't JSON", () => {
    expect(checkTransferPayload("transfer everything", expected, FUTURE)).not.toBeNull();
  });
});

describe("encodeErc191Signature", () => {
  it("normalizes v and recovers the signer from what the wallet signed", async () => {
    const account = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    const signature = await account.signMessage({ message: "hello" });
    expect(await recoverMessageAddress({ message: "hello", signature })).toBe(account.address);
    const encoded = encodeErc191Signature(signature);
    expect(encoded.startsWith("secp256k1:")).toBe(true);
  });

  it.each([["27", "1b", "00"], ["28", "1c", "01"], ["0", "00", "00"], ["1", "01", "01"]])("maps v=%s", (_, input, output) => {
    const encoded = encodeErc191Signature(`0x${"ab".repeat(64)}${input}`);
    const raw = encoded.slice("secp256k1:".length);
    expect(raw.length).toBeGreaterThan(0);
    const other = encodeErc191Signature(`0x${"ab".repeat(64)}${output}`);
    expect(encoded).toBe(other);
  });

  it("refuses a bad recovery byte or length", () => {
    expect(() => encodeErc191Signature(`0x${"ab".repeat(64)}05`)).toThrow();
    expect(() => encodeErc191Signature("0x1234")).toThrow();
  });
});
