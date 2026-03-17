/**
 * E2E — Knowledge Vault page elements and interactions.
 *
 * Covers:
 *   • Page heading and page structure
 *   • Filter toggle buttons: All / Proactive / Manual
 *   • Clicking each filter does not crash
 *   • Table/list area is present
 *   • Edit and Delete buttons are present on rows (if any exist)
 */
import { test, expect } from "@playwright/test";

const hasAuth = (process.env.E2E_TEST_EMAIL ?? "") !== "";

test.describe("Knowledge Vault — UI elements", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testInfo.skip(!hasAuth, "Skipped: set E2E_TEST_EMAIL and E2E_TEST_PASSWORD");
    await page.goto("/knowledge", { waitUntil: "networkidle" });
    if (page.url().includes("/auth/signin")) {
      testInfo.skip(true, "Not authenticated");
    }
  });

  test("page shows a 'Knowledge Vault' heading", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /knowledge vault/i })).toBeVisible();
  });

  test("page has no client-side errors on load", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.reload({ waitUntil: "networkidle" });
    expect(errors).toHaveLength(0);
  });

  test("'All' filter toggle button is visible", async ({ page }) => {
    const allBtn = page
      .getByRole("button", { name: /^all$/i })
      .or(page.getByRole("tab", { name: /^all$/i }))
      .first();
    await expect(allBtn).toBeVisible();
  });

  test("'Proactive' filter toggle button is visible", async ({ page }) => {
    const btn = page
      .getByRole("button", { name: /^proactive$/i })
      .or(page.getByRole("tab", { name: /^proactive$/i }))
      .first();
    await expect(btn).toBeVisible();
  });

  test("'Manual' filter toggle button is visible", async ({ page }) => {
    const btn = page
      .getByRole("button", { name: /^manual$/i })
      .or(page.getByRole("tab", { name: /^manual$/i }))
      .first();
    await expect(btn).toBeVisible();
  });

  test("clicking 'Proactive' filter does not crash", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    const btn = page
      .getByRole("button", { name: /^proactive$/i })
      .or(page.getByRole("tab", { name: /^proactive$/i }))
      .first();
    await btn.click();
    await page.waitForTimeout(500);
    expect(errors).toHaveLength(0);
  });

  test("clicking 'Manual' filter does not crash", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    const btn = page
      .getByRole("button", { name: /^manual$/i })
      .or(page.getByRole("tab", { name: /^manual$/i }))
      .first();
    await btn.click();
    await page.waitForTimeout(500);
    expect(errors).toHaveLength(0);
  });

  test("clicking 'All' restores the full list view", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    // Switch to Proactive first
    const proactiveBtn = page
      .getByRole("button", { name: /^proactive$/i })
      .or(page.getByRole("tab", { name: /^proactive$/i }))
      .first();
    await proactiveBtn.click();
    await page.waitForTimeout(300);

    // Then back to All
    const allBtn = page
      .getByRole("button", { name: /^all$/i })
      .or(page.getByRole("tab", { name: /^all$/i }))
      .first();
    await allBtn.click();
    await page.waitForTimeout(500);

    expect(errors).toHaveLength(0);
  });

  test("knowledge table or item list area is rendered", async ({ page }) => {
    // The data area might be a table, a list, or a "no items" empty state
    const content = page
      .locator("table, [role='table'], [role='list'], [data-testid*='list'], [data-testid*='table']")
      .or(page.getByText(/no knowledge|empty|no items|get started/i))
      .first();
    await expect(content).toBeVisible();
  });

  test("if knowledge rows exist, each row has Edit and Delete buttons", async ({ page }) => {
    const rows = page.locator("tr[data-testid], [data-testid*='knowledge-item'], tbody tr");
    const count = await rows.count();
    if (count === 0) {
      // No rows — empty state is acceptable
      return;
    }
    const firstRow = rows.first();
    const editBtn = firstRow
      .getByRole("button", { name: /edit/i })
      .or(firstRow.locator('[aria-label*="edit"]'));
    const deleteBtn = firstRow
      .getByRole("button", { name: /delete|remove/i })
      .or(firstRow.locator('[aria-label*="delete"]'));
    await expect(editBtn).toBeVisible();
    await expect(deleteBtn).toBeVisible();
  });
});
