/**
 * Playwright auth setup — runs ONCE before all other projects.
 *
 * If E2E_TEST_EMAIL + E2E_TEST_PASSWORD are set, it signs in and saves the
 * session cookies to tests/e2e/.auth/session.json.  All other projects load
 * that file via `storageState`, so no test has to sign in individually.
 *
 * If credentials are absent, an empty state file is written so that storage-
 * state-aware tests can still run (they will skip themselves if unauthenticated).
 */
import { test as setup, expect } from "@playwright/test";
import path from "path";
import fs from "fs";

const authFile = path.join(__dirname, "../.auth/session.json");

setup("authenticate", async ({ page }) => {
  // Ensure the .auth directory exists
  const authDir = path.dirname(authFile);
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  const email = process.env.E2E_TEST_EMAIL ?? "";
  const password = process.env.E2E_TEST_PASSWORD ?? "";

  if (!email || !password) {
    // Write an empty state so downstream projects don't crash on a missing file
    fs.writeFileSync(authFile, JSON.stringify({ cookies: [], origins: [] }));
    console.warn(
      "[auth.setup] ⚠  E2E_TEST_EMAIL / E2E_TEST_PASSWORD not set — " +
      "authenticated tests will be skipped."
    );
    return;
  }

  await page.goto("/auth/signin", { waitUntil: "networkidle" });

  // Fill credentials
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in with password/i }).click();

  // Wait for redirect away from sign-in
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/signin"), {
    timeout: 20_000,
  });

  // Confirm we landed on an authenticated page
  await expect(page.locator("body")).toBeVisible();

  // Persist session
  await page.context().storageState({ path: authFile });
  console.log("[auth.setup] ✓ Session saved to", authFile);
});
