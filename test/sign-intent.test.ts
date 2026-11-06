import { beforeEach, describe, expect, it, vi } from "vitest";
import { ONE_CLICK_QUOTE_KEY, type SignedQuote } from "@/lib/intents";
import { signTransfer, type PreparedTransfer } from "@/lib/sign-intent";
import * as wallet from "@/lib/wallet";
import generated from "./fixtures/generate-intent.json";
import payout from "./fixtures/quote-payout-live.json";

vi.mock("@/lib/wallet", () => ({
  connectWallet: vi.fn(),
  signMessage: vi.fn(),
  WalletError: class WalletError extends Error {},
}));

const SIGNER = "0xd8da6bf26964af9d7eed9e03e53415d37aa96045";
const RECIPIENT = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const USDC = "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near";

const prepared = (overrides: Partial<PreparedTransfer> = {}): PreparedTransfer => ({
  payload: generated.intent.payload,
  quote: structuredClone(payout),
  quoteKey: ONE_CLICK_QUOTE_KEY,
  signer: SIGNER,
  assetId: USDC,
  amountBase: "50000000",
  ...overrides,
});

// The fixtures are real 1Click responses, so these checks run on what the service actually sends.
beforeEach(() => {
  vi.mocked(wallet.connectWallet).mockReset().mockResolvedValue(SIGNER);
  vi.mocked(wallet.signMessage).mockReset().mockResolvedValue("0xsigned");
  vi.useFakeTimers({ toFake: ["Date"], now: Date.parse("2026-11-07T00:00:00Z") });
});

describe("before a wallet is ever asked to sign", () => {
  it("signs the exact payload when everything matches", async () => {
    await expect(signTransfer(prepared(), { recipient: RECIPIENT, mode: "live" })).resolves.toBe("0xsigned");
    expect(wallet.signMessage).toHaveBeenCalledWith(SIGNER, generated.intent.payload);
  });

  const refused = async (input: PreparedTransfer, expected = { recipient: RECIPIENT, mode: "live" as const }, reason?: RegExp) => {
    await expect(signTransfer(input, expected)).rejects.toThrow(reason);
    expect(wallet.signMessage).not.toHaveBeenCalled();
  };

  it("refuses a quote paying someone other than the destination shown", async () => {
    await refused(prepared(), { recipient: "0x000000000000000000000000000000000000dEaD", mode: "live" }, /different address/);
  });

  it("refuses a server that swapped the recipient inside the quote, because the signature breaks", async () => {
    const quote = structuredClone(payout) as unknown as SignedQuote;
    quote.quoteRequest.recipient = "0x000000000000000000000000000000000000dEaD";
    await refused(prepared({ quote }), { recipient: "0x000000000000000000000000000000000000dEaD", mode: "live" }, /signature/);
  });

  it("refuses a server's own signing key in live mode", async () => {
    const quote = structuredClone(payout) as unknown as SignedQuote;
    quote.signature = "ed25519:4Y62CbKEKjP3A1tnGM1kiwBap6x5VizdXY1DF3fPcFVJRW5ojt1SKEBCxLNWtShHYKoNSS3jpdrhtBMxPdBvxqzo";
    await refused(prepared({ quote, quoteKey: "ed25519:11111111111111111111111111111111" }), { recipient: RECIPIENT, mode: "live" }, /signature/);
  });

  it("refuses a payload that does more than the quote says", async () => {
    const parsed = JSON.parse(generated.intent.payload);
    parsed.intents.push({ intent: "add_public_key", public_key: "ed25519:attacker" });
    await refused(prepared({ payload: JSON.stringify(parsed) }), undefined, /failed its checks/);
  });

  it("refuses a payload moving more than was shown", async () => {
    await refused(prepared({ amountBase: "49000000" }), undefined, /failed its checks/);
  });

  it("refuses to sign from any wallet but the settlement wallet", async () => {
    vi.mocked(wallet.connectWallet).mockResolvedValue("0x000000000000000000000000000000000000dead");
    await refused(prepared(), undefined, /settlement wallet/);
  });
});
