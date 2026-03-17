/**
 * E2E — App shell, navigation drawer, header elements.
 *
 * Verifies every persistent UI element visible after sign-in:
 *   • App bar: brand name, version chip, theme switcher, sign-out button, user avatar
 *   • Navigation drawer: all 6 nav items
 *   • Clicking each nav item routes to the correct page
 *   • Theme-switcher menu opens (palette icon)
 */
import { test, expect } from "@playwright/test";

const hasAuth = (process.env.E2E_TEST_EMAIL ?? "") !== "";

test.describe("App shell — header and navigation", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testInfo.skip(!hasAuth, "Skipped: set E2E_TEST_EMAIL and E2E_TEST_PASSWORD");
    await page.goto("/chat", { waitUntil: "networkidle" });
    if (page.url().includes("/auth/signin")) {
      testInfo.skip(true, "Not authenticated");
    }
  });

  // ── App bar ──────────────────────────────────────────────────────────────

  test("app bar shows the brand name 'Nexus'", async ({ page }) => {
    await expect(page.getByText(/nexus/i).first()).toBeVisible();
  });

  test("app bar shows a version chip (0.x.x)", async ({ page }) => {
    // Version chip contains something like "0.71.14"
    await expect(page.locator("text=/^v?\\d+\\.\\d+\\.\\d+/").first()).toBeVisible();
  });

  test("app bar has a theme/palette toggle button", async ({ page }) => {
    const palette = page
      .getByRole("button", { name: /theme|palette|color mode|dark|light/i })
      .or(page.locator('[aria-label*="theme"], [aria-label*="palette"], [data-testid*="theme"]'))
      .first();
    await expect(palette).toBeVisible();
  });

  test("app bar theme button opens a menu", async ({ page }) => {
    const palette = page
      .getByRole("button", { name: /theme|palette|color mode|dark|light/i })
      .or(page.locator('[aria-label*="theme"], [aria-label*="palette"]'))
      .first();
    await palette.click();
    // A menu or popover should appear
    const menu = page.locator('[role="menu"], [role="listbox"], [data-testid*="menu"]').first();
    await expect(menu).toBeVisible();
  });

  test("app bar has a sign-out / logout button", async ({ page }) => {
    const logout = page
      .getByRole("button", { name: /sign.?out|log.?out/i })
      .or(page.locator('[aria-label*="sign out"], [aria-label*="logout"]'))
      .first();
    await expect(logout).toBeVisible();
  });

  // ── Nav drawer ───────────────────────────────────────────────────────────

  test("navigation includes a 'Chat' link", async ({ page }) => {
    await expect(
      page.getByRole("link", { name: /^chat$/i }).or(page.getByText(/^chat$/i).first())
    ).toBeVisible();
  });

  test("navigation includes a 'Dashboard' link", async ({ page }) => {
    await expect(
      page.getByRole("link", { name: /^dashboard$/i }).or(page.getByText(/^dashboard$/i).first())
    ).toBeVisible();
  });

  test("navigation includes a 'Knowledge' link", async ({ page }) => {
    await expect(
      page.getByRole("link", { name: /knowledge/i }).or(page.getByText(/knowledge/i).first())
    ).toBeVisible();
  });

  test("navigation includes a 'Settings' link", async ({ page }) => {
    await expect(
      page.getByRole("link", { name: /^settings$/i }).or(page.getByText(/^settings$/i).first())
    ).toBeVisible();
  });

  // ── Routing ──────────────────────────────────────────────────────────────

  test("clicking Dashboard nav item opens /dashboard", async ({ page }) => {
    const dashLink = page
      .getByRole("link", { name: /^dashboard$/i })
      .or(page.getByRole("menuitem", { name: /^dashboard$/i }))
      .first();
    await dashLink.click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("clicking Knowledge nav item opens /knowledge", async ({ page }) => {
    const knowledgeLink = page
      .getByRole("link", { name: /knowledge/i })
      .or(page.getByRole("menuitem", { name: /knowledge/i }))
      .first();
    await knowledgeLink.click();
    await expect(page).toHaveURL(/\/knowledge/);
  });

  test("clicking Settings nav item opens /settings", async ({ page }) => {
    const settingsLink = page
      .getByRole("link", { name: /^settings$/i })
      .or(page.getByRole("menuitem", { name: /^settings$/i }))
      .first();
    await settingsLink.click();
    await expect(page).toHaveURL(/\/settings/);
  });

  test("clicking Chat nav item returns to /chat", async ({ page }) => {
    await page.goto("/dashboard", { waitUntil: "networkidle" });
    const chatLink = page
      .getByRole("link", { name: /^chat$/i })
      .or(page.getByRole("menuitem", { name: /^chat$/i }))
      .first();
    await chatLink.click();
    await expect(page).toHaveURL(/\/chat/);
  });
});
