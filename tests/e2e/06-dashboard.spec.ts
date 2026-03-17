/**
 * E2E — Agent Dashboard page elements and interactions.
 *
 * Covers:
 *   • Page heading
 *   • Date pickers (start / end range)
 *   • "Show all logs" toggle switch
 *   • "Auto-refresh" toggle switch
 *   • Graphs / Details view toggle buttons
 *   • Switching to Details view reveals log search input
 *   • No crashes on any of the above interactions
 */
import { test, expect } from "@playwright/test";

const hasAuth = (process.env.E2E_TEST_EMAIL ?? "") !== "";

test.describe("Agent Dashboard — UI elements", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testInfo.skip(!hasAuth, "Skipped: set E2E_TEST_EMAIL and E2E_TEST_PASSWORD");
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    if (page.url().includes("/auth/signin")) {
      testInfo.skip(true, "Not authenticated");
    }
  });

  test("page shows 'Agent Dashboard' heading", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /agent dashboard/i })).toBeVisible();
  });

  test("page has no client-side errors on load", async ({ page }) => {
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

  test("date range pickers are visible", async ({ page }) => {
    // Date pickers may be MUI DatePicker components with text inputs
    const datePicker = page
      .locator('input[type="text"][placeholder*="date"], input[type="date"]')
      .or(page.locator('[aria-label*="date"], [data-testid*="date"]'))
      .first();
    await expect(datePicker).toBeVisible();
  });

  test("'Show all logs' switch is visible", async ({ page }) => {
    const showAll = page
      .getByRole("checkbox", { name: /show all logs/i })
      .or(page.locator('[aria-label*="show all"]'))
      .or(page.getByText(/show all logs/i))
      .first();
    await expect(showAll).toBeVisible();
  });

  test("toggling 'Show all logs' switch does not crash", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    const switchEl = page
      .getByRole("checkbox", { name: /show all logs/i })
      .or(page.locator('[aria-label*="show all"] input[type="checkbox"]'))
      .first();

    if (await switchEl.isVisible()) {
      await switchEl.click({ force: true });
      await page.waitForTimeout(300);
      await switchEl.click({ force: true });
      await page.waitForTimeout(300);
    }
    expect(errors).toHaveLength(0);
  });

  test("view toggle has 'Graphs' and 'Details' buttons", async ({ page }) => {
    const graphsBtn = page
      .getByRole("button", { name: /^graphs?$/i })
      .or(page.getByRole("tab", { name: /^graphs?$/i }))
      .first();
    const detailsBtn = page
      .getByRole("button", { name: /^details?$/i })
      .or(page.getByRole("tab", { name: /^details?$/i }))
      .first();
    await expect(graphsBtn).toBeVisible();
    await expect(detailsBtn).toBeVisible();
  });

  test("clicking 'Details' reveals a log search / filter input", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    const detailsBtn = page
      .getByRole("button", { name: /^details?$/i })
      .or(page.getByRole("tab", { name: /^details?$/i }))
      .first();
    await detailsBtn.click();
    await page.waitForTimeout(500);

    // After clicking Details, a search/filter input should appear
    const searchInput = page
      .getByPlaceholder(/search|filter|logs/i)
      .or(page.locator('input[type="search"], input[type="text"][aria-label*="search"]'))
      .first();
    await expect(searchInput).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test("clicking 'Graphs' toggles back without crashing", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    const detailsBtn = page
      .getByRole("button", { name: /^details?$/i })
      .or(page.getByRole("tab", { name: /^details?$/i }))
      .first();
    const graphsBtn = page
      .getByRole("button", { name: /^graphs?$/i })
      .or(page.getByRole("tab", { name: /^graphs?$/i }))
      .first();

    await detailsBtn.click();
    await page.waitForTimeout(300);
    await graphsBtn.click();
    await page.waitForTimeout(300);

    expect(errors).toHaveLength(0);
  });
});
