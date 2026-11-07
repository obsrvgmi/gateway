import { describe, expect, it } from "vitest";
import { baseToDecimal, decimalToBase, sumBase, usdToBase } from "@/lib/money";

describe("decimalToBase", () => {
  it("scales exactly, with no float rounding", () => {
    expect(decimalToBase("0.1", 18)).toBe(100000000000000000n);
    expect(decimalToBase("1234567890.123456789012345678", 18)).toBe(1234567890123456789012345678n);
    expect(decimalToBase("5", 6)).toBe(5000000n);
    expect(decimalToBase("1.50", 1)).toBe(15n);
  });

  it("refuses precision it would have to drop", () => {
    expect(() => decimalToBase("1.0000001", 6)).toThrow();
  });

  it.each(["1e18", "-1", "", ".5", "1.", "0x10", "1,000", "NaN", "Infinity"])("refuses %s", (value) => {
    expect(() => decimalToBase(value, 6)).toThrow();
  });
});

describe("baseToDecimal", () => {
  it("round trips", () => {
    expect(baseToDecimal(1500000n, 6)).toBe("1.5");
    expect(baseToDecimal("1000000000000000000000000", 24)).toBe("1");
    expect(baseToDecimal(1n, 24)).toBe("0.000000000000000000000001");
    expect(baseToDecimal(0n, 6)).toBe("0");
    expect(baseToDecimal(-1500000n, 6)).toBe("-1.5");
  });
});

describe("usdToBase", () => {
  it("pays a stablecoin one to one, whatever its market price", () => {
    expect(usdToBase(50, "USDC", 0.9995)).toBe(50_000_000n);
    expect(usdToBase(0.01, "USDT", 1.2)).toBe(10_000n);
  });

  it("converts at the given price for other assets", () => {
    expect(usdToBase(3280, "ETH", 3280)).toBe(1_000000000000000000n);
    expect(usdToBase(4.6, "NEAR", 4.6)).toBe(1_000000000000000000000000n);
  });

  it("rounds up, so the merchant is never short", () => {
    const amount = usdToBase(10, "ETH", 3);
    expect(amount).toBe(3333333333333333334n);
    expect(amount * 3n).toBeGreaterThanOrEqual(10_000000000000000000n);
  });

  it.each([[10, 0], [10, -1], [10, Number.NaN], [10, Number.POSITIVE_INFINITY], [10, 1e-12]])("refuses a bad price: usd %d price %d", (usd, price) => {
    expect(() => usdToBase(usd, "ETH", price)).toThrow();
  });

  it("refuses a bad amount", () => {
    expect(() => usdToBase(Number.NaN, "USDC", 1)).toThrow();
    expect(() => usdToBase(-1, "USDC", 1)).toThrow();
  });
});

describe("sumBase", () => {
  it("adds strings beyond double precision and skips nulls", () => {
    expect(sumBase(["9007199254740993", null, undefined, 1n])).toBe(9007199254740994n);
  });
});
