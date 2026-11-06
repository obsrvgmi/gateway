import { defineConfig, devices } from "@playwright/test";

/** Runs against the production build with a real worker and Postgres, in test mode. Run `npm run build` first. */
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./e2e/support/stack.ts",
  use: {
    baseURL: "http://localhost:3910",
    actionTimeout: 15_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
