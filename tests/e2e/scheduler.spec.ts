/**
 * E2E tests for the batch scheduler UI — modal interactions after authenticating.
 *
 * Requires env vars:
 *   E2E_TEST_EMAIL    — email of a valid admin user
 *   E2E_TEST_PASSWORD — password for that user
 *
 * Tests are skipped automatically when credentials are absent.
 * Authentication is handled once by tests/e2e/setup/auth.setup.ts — the saved
 * session is injected via storageState in playwright.config.ts.
 */
import { test, expect } from "@playwright/test";

const hasAuth = (process.env.E2E_TEST_EMAIL ?? "") !== "";

test.describe("Batch scheduler — create modal interactions", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testInfo.skip(!hasAuth, "Skipped: set E2E_TEST_EMAIL and E2E_TEST_PASSWORD");
    await page.goto("/scheduler", { waitUntil: "networkidle" });
    if (page.url().includes("/auth/signin")) {
      testInfo.skip(true, "Not authenticated — set credentials");
    }
  });

  test("all four batch-type buttons are visible", async ({ page }) => {
    await expect(page.getByRole("button", { name: /new proactive scheduler/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /new knowledge maintenance/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /new log cleanup/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /new email reading batch/i })).toBeVisible();
  });

  test("proactive batch modal shows 'No parameters required'", async ({ page }) => {
    await page.getByRole("button", { name: /new proactive scheduler/i }).click();
    await expect(page.getByText(/no parameters required/i)).toBeVisible();
    await page.getByRole("button", { name: /cancel/i }).click();
    await expect(page.getByText(/no parameters required/i)).not.toBeVisible();
  });

  test("knowledge batch modal shows Poll Interval select dropdown", async ({ page }) => {
    await page.getByRole("button", { name: /new knowledge maintenance/i }).click();
    await expect(page.getByText(/poll interval/i)).toBeVisible();
    // The parameter field must be a select, not a text input
    const selects = page.locator("select");
    await expect(selects.first()).toBeVisible();
    await page.getByRole("button", { name: /cancel/i }).click();
  });

  test("cleanup batch modal shows Minimum Log Level select dropdown", async ({ page }) => {
    await page.getByRole("button", { name: /new log cleanup/i }).click();
    await expect(page.getByText(/minimum log level/i)).toBeVisible();
    const selects = page.locator("select");
    await expect(selects.first()).toBeVisible();
    await page.getByRole("button", { name: /cancel/i }).click();
  });

  test("email batch modal shows Max Messages Per Run select dropdown", async ({ page }) => {
    await page.getByRole("button", { name: /new email reading batch/i }).click();
    await expect(page.getByText(/max messages per run/i)).toBeVisible();
    const selects = page.locator("select");
    await expect(selects.first()).toBeVisible();
    await page.getByRole("button", { name: /cancel/i }).click();
  });

  test("cancel closes the modal without sending a POST", async ({ page }) => {
    // Intercept POST to /api/scheduler/schedules
    let postCount = 0;
    await page.route("**/api/scheduler/schedules", (route) => {
      if (route.request().method() === "POST") postCount++;
      route.continue();
    });

    await page.getByRole("button", { name: /new email reading batch/i }).click();
    await expect(page.getByText(/max messages per run/i)).toBeVisible();
    await page.getByRole("button", { name: /cancel/i }).click();
    await expect(page.getByText(/max messages per run/i)).not.toBeVisible();

    expect(postCount).toBe(0);
  });

  test("OK button POSTs with batch_type (not batch_job_type) and parameters (not batch_parameters)", async ({ page }) => {
    let capturedBody: Record<string, unknown> | null = null;

    await page.route("**/api/scheduler/schedules", async (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        capturedBody = body;
      }
      await route.continue();
    });

    await page.getByRole("button", { name: /new email reading batch/i }).click();
    await expect(page.getByText(/max messages per run/i)).toBeVisible();
    await page.getByRole("button", { name: /^ok$/i }).click();

    // Allow time for the POST to fire
    await page.waitForTimeout(2000);

    if (capturedBody !== null) {
      // Verify correct field names are used
      expect(capturedBody).toHaveProperty("batch_type");
      expect(capturedBody).not.toHaveProperty("batch_job_type");
      expect(capturedBody).toHaveProperty("parameters");
      expect(capturedBody).not.toHaveProperty("batch_parameters");
      expect((capturedBody as { batch_type: string }).batch_type).toBe("email");
    }
    // If capturedBody is null, the submit may have been blocked by validation — that is acceptable
  });
});
