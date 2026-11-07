import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/** Separate from the main config on purpose: this talks to the real 1Click API and NEAR RPC. */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/support/empty.ts", import.meta.url)),
    },
  },
  test: {
    include: ["test/live/**/*.live.test.ts"],
    environment: "node",
    globalSetup: ["./test/support/global-postgres.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
