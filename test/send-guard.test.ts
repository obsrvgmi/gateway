import { describe, expect, it } from "vitest";
import { sendGuard } from "@/lib/send-guard";

const memory = () => {
  const store = new Map<string, string>();
  return { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value), removeItem: (key: string) => void store.delete(key) };
};

describe("remembering a send in this browser", () => {
  it("knows a wallet was asked, before the wallet has answered", () => {
    const guard = sendGuard("pay_1", memory());
    expect(guard.read()).toEqual({ state: "none" });
    guard.begin();
    expect(guard.read()).toEqual({ state: "pending" });
  });

  it("keeps the transaction once there is one", () => {
    const guard = sendGuard("pay_1", memory());
    guard.begin();
    guard.done("0xabc");
    expect(guard.read()).toEqual({ state: "sent", txHash: "0xabc" });
  });

  it("forgets it when the wallet said no", () => {
    const guard = sendGuard("pay_1", memory());
    guard.begin();
    guard.clear();
    expect(guard.read()).toEqual({ state: "none" });
  });

  it("keeps separate payments apart", () => {
    const storage = memory();
    sendGuard("pay_1", storage).done("0xabc");
    expect(sendGuard("pay_2", storage).read()).toEqual({ state: "none" });
  });

  it("carries on where storage is refused, because the server's record still applies", () => {
    const refusing = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); }, removeItem: () => { throw new Error("denied"); } };
    const guard = sendGuard("pay_1", refusing);
    expect(() => guard.begin()).not.toThrow();
    expect(guard.read()).toEqual({ state: "none" });
    expect(sendGuard("pay_1", null).read()).toEqual({ state: "none" });
  });
});
