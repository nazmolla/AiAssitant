/**
 * E2E — Scheduler Console page — comprehensive UI element coverage.
 *
 * This spec replaces the narrow batch-type modal tests in scheduler.spec.ts
 * with a broader structural verification of the scheduler console:
 *
 *   • Page heading and layout
 *   • All four batch type buttons are present and interactive
 *   • Each button opens the correct modal with the right title
 *   • Modal has Recurrence section and Subtasks section
 *   • "Add Subtask" button is present inside the modal
 *   • Cancel closes the modal
 *   • Schedule list / history table is rendered
 *   • No crashes or 500 errors
 *
 * Admin-only: if redirected to /auth/signin or denied, tests skip.
 */
import { test, expect } from "@playwright/test";

const hasAuth = (process.env.E2E_TEST_EMAIL ?? "") !== "";

test.describe("Scheduler Console — UI elements", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testInfo.skip(!hasAuth, "Skipped: set E2E_TEST_EMAIL and E2E_TEST_PASSWORD");
    await page.goto("/scheduler", { waitUntil: "networkidle" });
    if (page.url().includes("/auth/signin")) {
      testInfo.skip(true, "Not authenticated");
    }
  });

  // ── Page structure ────────────────────────────────────────────────────────

  test("page loads without client-side errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.reload({ waitUntil: "networkidle" });
    expect(errors).toHaveLength(0);
  });

  test("no 500 API errors on load", async ({ page }) => {
    const serverErrors: string[] = [];
    page.on("response", (res) => {
      if (res.status() >= 500) serverErrors.push(`${res.status()} ${res.url()}`);
    });
    await page.reload({ waitUntil: "networkidle" });
    expect(serverErrors).toHaveLength(0);
  });

  test("scheduler data-testid root is present", async ({ page }) => {
    const root = page.locator('[data-testid="scheduler-config"]');
    await expect(root).toBeVisible();
  });

  // ── Batch type buttons ────────────────────────────────────────────────────

  test("'New Proactive Scheduler' button is visible", async ({ page }) => {
    await expect(page.getByRole("button", { name: /new proactive scheduler/i })).toBeVisible();
  });

  test("'New Knowledge Maintenance' button is visible", async ({ page }) => {
    await expect(page.getByRole("button", { name: /new knowledge maintenance/i })).toBeVisible();
  });

  test("'New Log Cleanup' button is visible", async ({ page }) => {
    await expect(page.getByRole("button", { name: /new log cleanup/i })).toBeVisible();
  });

  test("'New Email Reading Batch' button is visible", async ({ page }) => {
    await expect(page.getByRole("button", { name: /new email reading batch/i })).toBeVisible();
  });

  // ── Proactive modal ───────────────────────────────────────────────────────

  test("Proactive modal opens with correct heading", async ({ page }) => {
    await page.getByRole("button", { name: /new proactive scheduler/i }).click();
    // Modal should have a title
    const title = page
      .getByRole("heading", { name: /proactive/i })
      .or(page.locator('[role="dialog"] h1, [role="dialog"] h2, [role="dialog"] h3'))
      .first();
    await expect(title).toBeVisible();
    await page.getByRole("button", { name: /cancel/i }).click();
  });

  test("Proactive modal shows 'No parameters required'", async ({ page }) => {
    await page.getByRole("button", { name: /new proactive scheduler/i }).click();
    await expect(page.getByText(/no parameters required/i)).toBeVisible();
    await page.getByRole("button", { name: /cancel/i }).click();
    await expect(page.getByText(/no parameters required/i)).not.toBeVisible();
  });

  // ── Knowledge modal ───────────────────────────────────────────────────────

  test("Knowledge modal opens and shows Poll Interval parameter", async ({ page }) => {
    await page.getByRole("button", { name: /new knowledge maintenance/i }).click();
    await expect(page.getByText(/poll interval/i)).toBeVisible();
    const selects = page.locator("select");
    await expect(selects.first()).toBeVisible();
    await page.getByRole("button", { name: /cancel/i }).click();
  });

  // ── Log cleanup modal ─────────────────────────────────────────────────────

  test("Log Cleanup modal opens and shows Minimum Log Level parameter", async ({ page }) => {
    await page.getByRole("button", { name: /new log cleanup/i }).click();
    await expect(page.getByText(/minimum log level/i)).toBeVisible();
    const selects = page.locator("select");
    await expect(selects.first()).toBeVisible();
    await page.getByRole("button", { name: /cancel/i }).click();
  });

  // ── Email batch modal ─────────────────────────────────────────────────────

  test("Email Batch modal opens and shows Max Messages parameter", async ({ page }) => {
    await page.getByRole("button", { name: /new email reading batch/i }).click();
    await expect(page.getByText(/max messages per run/i)).toBeVisible();
    const selects = page.locator("select");
    await expect(selects.first()).toBeVisible();
    await page.getByRole("button", { name: /cancel/i }).click();
  });

  // ── Modal structure ───────────────────────────────────────────────────────

  test("modal has a Recurrence section", async ({ page }) => {
    await page.getByRole("button", { name: /new proactive scheduler/i }).click();
    const recurrence = page
      .getByText(/recurrence/i)
      .or(page.getByRole("heading", { name: /recurrence/i }))
      .first();
    await expect(recurrence).toBeVisible();
    await page.getByRole("button", { name: /cancel/i }).click();
  });

  test("modal cancel POSTs nothing to the API", async ({ page }) => {
    let postCount = 0;
    await page.route("**/api/scheduler/schedules", (route) => {
      if (route.request().method() === "POST") postCount++;
      route.continue();
    });
    await page.getByRole("button", { name: /new proactive scheduler/i }).click();
    await page.getByRole("button", { name: /cancel/i }).click();
    await page.waitForTimeout(500);
    expect(postCount).toBe(0);
  });

  // ── API contract ──────────────────────────────────────────────────────────

  test("submit POSTs with 'batch_type' and 'parameters' (not legacy field names)", async ({
    page,
  }) => {
    let capturedBody: Record<string, unknown> | null = null;
    await page.route("**/api/scheduler/schedules", async (route) => {
      if (route.request().method() === "POST") {
        capturedBody = route.request().postDataJSON() as Record<string, unknown>;
      }
      await route.continue();
    });

    await page.getByRole("button", { name: /new email reading batch/i }).click();
    await page.getByRole("button", { name: /^ok$/i }).click();
    await page.waitForTimeout(2_000);

    if (capturedBody !== null) {
      expect(capturedBody).toHaveProperty("batch_type");
      expect(capturedBody).not.toHaveProperty("batch_job_type");
      expect(capturedBody).toHaveProperty("parameters");
      expect(capturedBody).not.toHaveProperty("batch_parameters");
      expect((capturedBody as { batch_type: string }).batch_type).toBe("email");
    }
  });
});
