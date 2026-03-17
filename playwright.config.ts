import { defineConfig, devices } from "@playwright/test";
import path from "path";

/**
 * Base URL for tests. Override for production smoke-testing:
 *   PLAYWRIGHT_BASE_URL=https://192.168.0.30 npx playwright test
 */
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3001";
const isLocal = BASE_URL.includes("localhost") || BASE_URL.includes("127.0.0.1");

/** Saved session state from the auth setup step. */
const AUTH_STATE = path.join(__dirname, "tests/e2e/.auth/session.json");

export default defineConfig({
  testDir: "./tests/e2e",

  /**
   * 60 s default; integration tests call test.setTimeout(180_000) themselves.
   * Auth setup also uses the default.
   */
  timeout: 60_000,
  expect: { timeout: 15_000 },

  /** Serial workers avoid session-state race conditions across tests. */
  fullyParallel: false,
  workers: process.env.CI ? 1 : 2,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "dot" : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  /* Only spin up the web-server when testing locally. */
  ...(isLocal
    ? {
        webServer: {
          command: "npx next start -p 3001",
          url: "http://localhost:3001",
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }
    : {}),

  projects: [
    /**
     * 1. Auth setup — runs FIRST, saves session cookies to .auth/session.json.
     *    Only matches *.setup.ts files, so regular specs are excluded.
     */
    {
      name: "setup",
      testMatch: /setup\/auth\.setup\.ts/,
      use: { baseURL: BASE_URL },
    },

    /** 2. Desktop Chrome — all spec files, authenticated via stored session. */
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: AUTH_STATE },
      dependencies: ["setup"],
    },

    /** 3. Mobile Chrome — authenticated. */
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"], storageState: AUTH_STATE },
      dependencies: ["setup"],
    },

    /** 4–5. iPhones — authenticated. */
    {
      name: "iphone-portrait",
      use: { ...devices["iPhone 16 Pro Max"], storageState: AUTH_STATE },
      dependencies: ["setup"],
    },
    {
      name: "iphone-landscape",
      use: { ...devices["iPhone 16 Pro Max landscape"], storageState: AUTH_STATE },
      dependencies: ["setup"],
    },
  ],
});
