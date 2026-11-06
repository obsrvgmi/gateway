import { beforeEach, describe, expect, it, vi } from "vitest";
import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";
import { checkIntentQuote, checkRouteQuote, ONE_CLICK_QUOTE_KEY, quoteMessage, verifyQuoteSignature, walletChallengeBody, type SignedQuote } from "@/lib/intents";
import { signChallenge, signTransfer, verifiedRouteAddress, type ExpectedMove, type PreparedTransfer } from "@/lib/sign-intent";
import * as wallet from "@/lib/wallet";
import dry from "./fixtures/quote-dry.json";
import generated from "./fixtures/generate-intent.json";
import live from "./fixtures/quote-live.json";
import payout from "./fixtures/quote-payout-live.json";

const USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";
const ACCOUNT_LOWER = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";

vi.mock("@/lib/wallet", () => ({
  connectWallet: vi.fn(),
  signMessage: vi.fn(),
  WalletError: class WalletError extends Error {},
}));

const SIGNER = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
const RECIPIENT = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

const prepared = (overrides: Partial<PreparedTransfer> = {}): PreparedTransfer => ({
  payload: generated.intent.payload,
  quote: structuredClone(payout),
  quoteKey: ONE_CLICK_QUOTE_KEY,
  ...overrides,
});

const EXPECTED: ExpectedMove = { signer: SIGNER, recipient: RECIPIENT, asset: "USDC", receiveAsset: "USDC", amountBase: "50000000" };

/** Run as a production bundle: only NEAR's key is trusted. */
const strict = (input: PreparedTransfer, expected = EXPECTED) => signTransfer(input, expected, false);

// The fixtures are real 1Click responses, so these checks run on what the service actually sends.
beforeEach(() => {
  vi.mocked(wallet.connectWallet).mockReset().mockResolvedValue(SIGNER);
  vi.mocked(wallet.signMessage).mockReset().mockResolvedValue("0xsigned");
  vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-11-06T16:35:00Z") });
});

const refused = async (attempt: Promise<unknown>, reason?: RegExp) => {
  await expect(attempt).rejects.toThrow(reason);
  expect(wallet.signMessage).not.toHaveBeenCalled();
};

describe("before a wallet is ever asked to sign", () => {
  it("signs the exact payload when everything matches", async () => {
    await expect(strict(prepared())).resolves.toBe("0xsigned");
    expect(wallet.signMessage).toHaveBeenCalledWith(SIGNER, generated.intent.payload);
  });

  it("refuses a quote paying someone other than the destination shown", async () => {
    await refused(strict(prepared(), { ...EXPECTED, recipient: "0x000000000000000000000000000000000000dEaD" }), /different address/);
  });

  it("refuses a server that swapped the recipient inside the quote, because the signature breaks", async () => {
    const quote = structuredClone(payout) as unknown as SignedQuote;
    quote.quoteRequest.recipient = "0x000000000000000000000000000000000000dEaD";
    await refused(strict(prepared({ quote }), { ...EXPECTED, recipient: "0x000000000000000000000000000000000000dEaD" }), /signature/);
  });

  describe("a free dry quote with an attacker's address added", () => {
    // Signatures on dry quotes don't cover a deposit address, so this one verifies.
    const attack = () => {
      const quote = structuredClone(dry) as unknown as SignedQuote;
      quote.quote.depositAddress = "attacker-routing-address";
      return quote;
    };

    it("does verify, which is why the signature alone can't be enough", () => {
      expect(verifyQuoteSignature(attack())).toBe(true);
    });

    it("is refused in the browser", async () => {
      await refused(strict(prepared({ quote: attack() }), { ...EXPECTED, recipient: ACCOUNT_LOWER }));
    });

    it("is refused for not being live, even when every other field agrees", async () => {
      const quote = attack();
      quote.quoteRequest.depositType = "INTENTS";
      quote.quoteRequest.refundType = "INTENTS";
      expect(checkIntentQuote(quote, { owner: String(quote.quoteRequest.refundTo), recipient: String(quote.quoteRequest.recipient), originAssetId: String(quote.quoteRequest.originAsset), destinationAssetId: String(quote.quoteRequest.destinationAsset), amount: String(quote.quoteRequest.amount) })).toBe("This isn't a live quote.");
    });
  });

  describe("a real quote, used for something other than what it says", () => {
    it("refuses a payload moving a different asset", async () => {
      const parsed = JSON.parse(generated.intent.payload);
      parsed.intents[0].tokens = { "nep141:eth.omft.near": "1000000000000000000" };
      await refused(strict(prepared({ payload: JSON.stringify(parsed) })), /failed its checks/);
    });

    it("refuses a payload moving more", async () => {
      const parsed = JSON.parse(generated.intent.payload);
      parsed.intents[0].tokens = { [USDC]: "99000000" };
      await refused(strict(prepared({ payload: JSON.stringify(parsed) })), /failed its checks/);
    });

    it.each<[string, Partial<ExpectedMove>, RegExp]>([
      ["an amount other than the merchant chose", { amountBase: "49000000" }, /different amount/],
      ["an asset other than the merchant chose", { asset: "ETH" }, /different asset/],
      ["a payout asset other than the merchant chose", { receiveAsset: "ETH" }, /pays out in a different asset/],
      ["a signer the funds would not return to", { signer: "0x0000000000000000000000000000000000000001" }, /returns funds to someone else/],
    ])("refuses %s", async (_, change, reason) => {
      await refused(strict(prepared(), { ...EXPECTED, ...change }), reason);
    });

    it("refuses one that doesn't draw on the balance", async () => {
      const quote = structuredClone(payout) as unknown as SignedQuote;
      quote.quoteRequest.depositType = "ORIGIN_CHAIN";
      expect(checkIntentQuote(quote, { owner: SIGNER, recipient: RECIPIENT, originAssetId: USDC, destinationAssetId: USDC, amount: "50000000" })).toMatch(/draw on your balance/);
    });
  });

  describe("a server that signs its own quote, with its own key", () => {
    const attackerKey = ed25519.utils.randomPrivateKey();
    const attackerPublic = `ed25519:${base58.encode(ed25519.getPublicKey(attackerKey))}`;
    const forged = () => {
      const quote = structuredClone(payout) as unknown as SignedQuote;
      quote.signature = `ed25519:${base58.encode(ed25519.sign(quoteMessage(quote), attackerKey))}`;
      return quote;
    };

    it("is refused by a production bundle, whatever key or mode it claims", async () => {
      await refused(strict(prepared({ quote: forged(), quoteKey: attackerPublic })), /signature/);
    });

    it("works only in a test build, where the simulator's key is per process", async () => {
      await expect(signTransfer(prepared({ quote: forged(), quoteKey: attackerPublic }), EXPECTED, true)).resolves.toBe("0xsigned");
    });
  });

  it("refuses a payload that does more than the quote says", async () => {
    const parsed = JSON.parse(generated.intent.payload);
    parsed.intents.push({ intent: "add_public_key", public_key: "ed25519:attacker" });
    await refused(strict(prepared({ payload: JSON.stringify(parsed) })), /failed its checks/);
  });

  it("refuses to sign from any wallet but the one holding the funds", async () => {
    vi.mocked(wallet.connectWallet).mockResolvedValue("0x000000000000000000000000000000000000dead");
    await refused(strict(prepared()), /holds these funds/);
  });
});

describe("what else a live quote can try", () => {
  const NOW = Date.parse("2026-11-06T16:35:00Z");
  const expected = { owner: SIGNER, recipient: RECIPIENT, originAssetId: USDC, destinationAssetId: USDC, amount: "50000000" };
  const quote = (change: (response: SignedQuote) => void = () => undefined) => {
    const response = structuredClone(payout) as unknown as SignedQuote;
    change(response);
    return response;
  };

  it("passes when nothing's off", () => {
    expect(checkIntentQuote(quote(), expected, NOW)).toBeNull();
  });

  it.each<[string, (response: SignedQuote) => void, RegExp]>([
    ["wider slippage", (r) => { r.quoteRequest.slippageTolerance = 5000; }, /slippage/],
    ["no slippage stated", (r) => { delete r.quoteRequest.slippageTolerance; }, /slippage/],
    ["a message for the recipient", (r) => { r.quoteRequest.customRecipientMsg = "x"; }, /instructions/],
    ["a virtual chain recipient", (r) => { r.quoteRequest.virtualChainRecipient = "x"; }, /instructions/],
    ["a virtual chain refund recipient", (r) => { r.quoteRequest.virtualChainRefundRecipient = "x"; }, /instructions/],
    ["a deadline that's passed", (r) => { r.quote.deadline = "2026-11-06T16:00:00.000Z"; }, /expired/],
    ["no deadline", (r) => { delete r.quote.deadline; }, /expired/],
    // Validly signed, but from an earlier move, so its address may be spent.
    ["an old quote for the same move", (r) => { r.timestamp = "2026-11-06T15:00:00.000Z"; }, /too old/],
    ["no timestamp", (r) => { r.timestamp = ""; }, /too old/],
  ])("refuses %s", (_, change, reason) => {
    expect(checkIntentQuote(quote(change), expected, NOW)).toMatch(reason);
  });

  it("refuses a signature that would stay usable for far too long", async () => {
    const parsed = JSON.parse(generated.intent.payload);
    parsed.deadline = "2027-01-01T00:00:00.000Z";
    await refused(strict(prepared({ payload: JSON.stringify(parsed) })), /too long/);
  });
});

describe("a direct-mode refund's address", () => {
  const route = () => structuredClone(live) as unknown as SignedQuote;
  const ETH = "nep141:eth.omft.near";

  it("is refused unless the quote really is a deposit from the merchant's wallet", () => {
    // A real live quote, but an EXACT_OUTPUT into Intents: not what a route refund looks like.
    expect(() => verifiedRouteAddress({ quote: route(), quoteKey: ONE_CLICK_QUOTE_KEY }, EXPECTED, false)).toThrow();
    expect(checkRouteQuote(route(), { owner: RECIPIENT, recipient: ACCOUNT_LOWER, originAssetId: ETH, destinationAssetId: USDC, amount: "50000000" })).toMatch(/chain shown/);
  });

  it("is refused when a failed route would return the funds to anyone but the wallet sending them", () => {
    const quote = structuredClone(live) as unknown as SignedQuote;
    Object.assign(quote.quoteRequest, { recipientType: "DESTINATION_CHAIN", depositType: "ORIGIN_CHAIN", refundType: "ORIGIN_CHAIN", swapType: "EXACT_INPUT" });
    const request = quote.quoteRequest;
    const expected = { owner: String(request.refundTo), recipient: String(request.recipient), originAssetId: String(request.originAsset), destinationAssetId: String(request.destinationAsset), amount: String(request.amount) };
    const NOW = Date.parse("2026-11-06T16:35:00Z");
    expect(checkRouteQuote(quote, expected, NOW)).toBeNull();
    expect(checkRouteQuote(quote, { ...expected, owner: "0x0000000000000000000000000000000000000001" }, NOW)).toMatch(/someone else/);
  });

  it("is refused on a broken signature", () => {
    const quote = route();
    quote.quote.depositAddress = "attacker";
    expect(() => verifiedRouteAddress({ quote, quoteKey: ONE_CLICK_QUOTE_KEY }, EXPECTED, false)).toThrow(/signature/);
  });
});

describe("what a wallet is asked to sign for an account change", () => {
  const ORG = "org_abc123";
  const WALLET = "0x8fd379246834eac74b8419ffda202cf8051f7a03";
  const good = (action: "settlement" | "destination" = "settlement", address = WALLET) => `${walletChallengeBody(action, ORG, address, "2026-11-06T12:00:00.000Z")}\nCode: ${"a".repeat(32)}`;

  it("is signed when it says exactly what it should", async () => {
    await expect(signChallenge(WALLET, good(), "settlement", WALLET)).resolves.toBe("0xsigned");
  });

  // Each of these, signed, would be a real instruction or the wrong approval. The first gives away the balance.
  it.each<[string, string]>([
    ["an intent adding the attacker's key", JSON.stringify({ signer_id: WALLET, verifying_contract: "intents.near", deadline: "2030-01-01T00:00:00Z", nonce: "x", intents: [{ intent: "add_public_key", public_key: "ed25519:attacker" }] })],
    ["a challenge for another address", good("settlement", "0x0000000000000000000000000000000000000001")],
    ["a destination challenge when changing the wallet", good("destination")],
    ["a real challenge with an instruction added", `${good()}\n{"intents":[{"intent":"add_public_key"}]}`],
    ["text in front of a real challenge", `Sign this\n${good()}`],
    ["an empty message", ""],
  ])("refuses %s", async (_, message) => {
    await refused(signChallenge(WALLET, message, "settlement", WALLET), /didn't look right/);
  });
});
