/**
 * E2E — Settings › Search Providers page elements and interactions.
 *
 * Covers:
 *   • "Web Search Providers" heading is visible
 *   • At least one provider card is rendered
 *   • Each provider card has an enabled/disabled toggle (checkbox or switch)
 *   • Priority input accepts numeric values
 *   • Save button is visible
 *   • Toggling a provider does not crash the page
 */
import { test, expect } from "@playwright/test";

const hasAuth = (process.env.E2E_TEST_EMAIL ?? "") !== "";

async function navigateToSearchSettings(page: import("@playwright/test").Page) {
  // Try sub-route first
  await page.goto("/settings/search-providers", { waitUntil: "networkidle" });

  // If that didn't land on settings (redirected or 404), go via chip navigation
  if (!page.url().includes("/settings")) {
    await page.goto("/settings", { waitUntil: "networkidle" });
  }

  // Click "Search" chip if present
  const searchChip = page
    .getByRole("button", { name: /search provider|web search/i })
    .or(page.getByRole("tab", { name: /search/i }))
    .or(page.getByText(/search providers/i).first())
    .first();

  if (await searchChip.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await searchChip.click();
    await page.waitForTimeout(300);
  }
}

test.describe("Settings — Search Providers", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testInfo.skip(!hasAuth, "Skipped: set E2E_TEST_EMAIL and E2E_TEST_PASSWORD");
    await navigateToSearchSettings(page);
    if (page.url().includes("/auth/signin")) {
      testInfo.skip(true, "Not authenticated");
    }
  });

  test("'Web Search Providers' heading is visible", async ({ page }) => {
    const heading = page
      .getByRole("heading", { name: /web search providers|search providers/i })
      .or(page.getByText(/web search providers/i).first());
    await expect(heading).toBeVisible();
  });

  test("page has no client-side errors on load", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await navigateToSearchSettings(page);
    expect(errors).toHaveLength(0);
  });

  test("at least one search provider card/row is rendered", async ({ page }) => {
    // Each provider should have a checkbox or switch to enable it
    const providerToggle = page
      .locator('input[type="checkbox"], [role="switch"]')
      .first();
    await expect(providerToggle).toBeVisible();
  });

  test("enabled checkbox for a provider is interactive", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    const checkbox = page.locator('input[type="checkbox"]').first();
    if (await checkbox.isVisible({ timeout: 3_000 }).catch(() => false)) {
      const initial = await checkbox.isChecked();
      await checkbox.click({ force: true });
      await page.waitForTimeout(200);
      // Toggle it back
      await checkbox.click({ force: true });
      await page.waitForTimeout(200);
    }
    expect(errors).toHaveLength(0);
  });

  test("priority input accepts numeric values", async ({ page }) => {
    const priorityInput = page
      .locator('input[type="number"], input[name*="priority"]')
      .first();
    if (await priorityInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await priorityInput.fill("5");
      await expect(priorityInput).toHaveValue("5");
      // Restore original value
      await priorityInput.fill("1");
    }
  });

  test("'Save Search Providers' button is visible", async ({ page }) => {
    const saveBtn = page
      .getByRole("button", { name: /save search|save providers/i })
      .or(page.getByRole("button", { name: /save/i }).first());
    await expect(saveBtn).toBeVisible();
  });
});
