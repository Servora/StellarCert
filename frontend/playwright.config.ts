import { defineConfig, devices } from "@playwright/test";

// The cross-stack smoke suite runs against a real, already-running stack
// (docker compose up: backend + frontend + postgres + redis), started by the
// e2e-smoke CI job (or by hand with `npm run test:e2e:stack` from the repo
// root) - it never starts its own server.
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.mjs",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "cross-stack-smoke",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
