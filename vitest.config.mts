import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // `server-only` throws outside a Next server build. Tests run server code directly.
      "server-only": fileURLToPath(new URL("./test/support/empty.ts", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.test.ts", "packages/**/*.test.ts"],
    exclude: ["node_modules", ".next", "test/live/**"],
    environment: "node",
    globalSetup: ["./test/support/global-postgres.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
