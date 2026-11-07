import { describe, expect, it } from "vitest";
import { isValidAddress } from "@/lib/address";

describe("isValidAddress", () => {
  it.each([
    ["evm", "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"],
    ["evm", "0xd8da6bf26964af9d7eed9e03e53415d37aa96045"],
    ["btc", "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"],
    ["btc", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"],
    ["btc", "3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy"],
    ["sol", "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"],
    ["tron", "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7"],
    ["near", "alice.near"],
    ["near", "sub.alice.near"],
    ["near", "c3d8b0a6f3c7c8d9e0a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5a6b"],
  ] as const)("accepts a %s address: %s", (kind, value) => {
    expect(isValidAddress(kind, value)).toBe(true);
  });

  it.each([
    ["evm", "0x123"],
    ["evm", "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96044"],
    ["evm", "alice.near"],
    ["btc", "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdx"],
    ["btc", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN3"],
    ["btc", "0xd8da6bf26964af9d7eed9e03e53415d37aa96045"],
    ["sol", "0xd8da6bf26964af9d7eed9e03e53415d37aa96045"],
    ["sol", "short"],
    ["tron", "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU8"],
    ["tron", "1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2"],
    ["near", "UPPER.near"],
    ["near", "a"],
    // A valid NEAR name, and almost certainly an EVM address pasted by mistake. A NEAR payout must not go there.
    ["near", "0xd8da6bf26964af9d7eed9e03e53415d37aa96045"],
  ] as const)("refuses as a %s address: %s", (kind, value) => {
    expect(isValidAddress(kind, value)).toBe(false);
  });
});
