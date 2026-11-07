import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnv } from "@/server/env";
import { postWebhook } from "@/server/webhooks/deliver";

const resolved = vi.hoisted(() => ({ addresses: [] as { address: string; family: number }[] }));

vi.mock("node:dns", () => ({
  lookup: (_host: string, _options: unknown, callback: (error: null, addresses: unknown) => void) => callback(null, resolved.addresses),
}));

beforeEach(() => {
  Object.assign(process.env, { DATABASE_URL: "postgres://unused", SECRET_KEY: "test-secret-key-test-secret-key-test", WEBHOOKS_ALLOW_PRIVATE: "false" });
  resetEnv();
});

/**
 * DNS rebinding: a merchant's URL looks public, and passes every check on the name, but points at our
 * own network when the connection opens. The check sits inside the socket's lookup, so it sees that.
 */
describe("a public name that resolves somewhere private", () => {
  it.each(["127.0.0.1", "10.0.0.5", "169.254.169.254", "::1"])("is refused when it resolves to %s", async (address) => {
    resolved.addresses = [{ address, family: address.includes(":") ? 6 : 4 }];
    await expect(postWebhook("https://looks-public.example/h", "{}", {})).rejects.toThrow(/private/);
  });

  it("is refused when any one of its addresses is private", async () => {
    resolved.addresses = [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.5", family: 4 }];
    await expect(postWebhook("https://looks-public.example/h", "{}", {})).rejects.toThrow(/private/);
  });
});
