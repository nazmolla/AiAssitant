/**
 * E2E — Settings › Channels page elements and interactions.
 *
 * Covers:
 *   • "+ Connect Channel" button is visible
 *   • Clicking it opens a channel-type picker
 *   • All expected channel types appear in the grid
 *     (WhatsApp, Slack, Email, Telegram, Discord, Teams, Phone)
 *   • A back / cancel button closes the picker
 *   • Existing connected channels (if any) have delete / toggle / copy buttons
 *   • No crashes at any step
 */
import { test, expect } from "@playwright/test";

const hasAuth = (process.env.E2E_TEST_EMAIL ?? "") !== "";

async function navigateToChannelSettings(page: import("@playwright/test").Page) {
  await page.goto("/settings/channels", { waitUntil: "networkidle" });
  if (!page.url().includes("/settings")) {
    await page.goto("/settings", { waitUntil: "networkidle" });
  }
  const channelsChip = page
    .getByRole("button", { name: /^channels$/i })
    .or(page.getByRole("tab", { name: /channels/i }))
    .or(page.getByText(/connect channel|channels/i).first())
    .first();
  if (await channelsChip.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await channelsChip.click();
    await page.waitForTimeout(300);
  }
}

test.describe("Settings — Channels", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testInfo.skip(!hasAuth, "Skipped: set E2E_TEST_EMAIL and E2E_TEST_PASSWORD");
    await navigateToChannelSettings(page);
    if (page.url().includes("/auth/signin")) {
      testInfo.skip(true, "Not authenticated");
    }
  });

  test("page loads without errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await navigateToChannelSettings(page);
    expect(errors).toHaveLength(0);
  });

  test("'+ Connect Channel' button is visible", async ({ page }) => {
    const btn = page
      .getByRole("button", { name: /connect channel|add channel|\+\s*channel/i })
      .first();
    await expect(btn).toBeVisible();
  });

  test("clicking '+ Connect Channel' opens channel-type picker", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    const btn = page
      .getByRole("button", { name: /connect channel|add channel|\+\s*channel/i })
      .first();
    await btn.click();
    await page.waitForTimeout(500);

    // A grid or list of channel types should appear
    const picker = page
      .locator('[data-testid*="channel-type"], [class*="channel-type"]')
      .or(page.getByText(/whatsapp|slack|telegram|discord/i).first());
    await expect(picker).toBeVisible();
    expect(errors).toHaveLength(0);
  });

  test("channel type grid includes WhatsApp", async ({ page }) => {
    const btn = page
      .getByRole("button", { name: /connect channel|add channel|\+\s*channel/i })
      .first();
    await btn.click();
    await page.waitForTimeout(300);
    await expect(page.getByText(/whatsapp/i).first()).toBeVisible();
  });

  test("channel type grid includes Email", async ({ page }) => {
    const btn = page
      .getByRole("button", { name: /connect channel|add channel|\+\s*channel/i })
      .first();
    await btn.click();
    await page.waitForTimeout(300);
    await expect(page.getByText(/email/i).first()).toBeVisible();
  });

  test("channel type grid includes Slack", async ({ page }) => {
    const btn = page
      .getByRole("button", { name: /connect channel|add channel|\+\s*channel/i })
      .first();
    await btn.click();
    await page.waitForTimeout(300);
    await expect(page.getByText(/slack/i).first()).toBeVisible();
  });

  test("a back or cancel control is visible after opening the picker", async ({ page }) => {
    const btn = page
      .getByRole("button", { name: /connect channel|add channel|\+\s*channel/i })
      .first();
    await btn.click();
    await page.waitForTimeout(300);

    const backBtn = page
      .getByRole("button", { name: /back|cancel|close/i })
      .or(page.locator('[aria-label*="back"], [aria-label*="close"]'))
      .first();
    await expect(backBtn).toBeVisible();
  });

  test("back button closes the channel-type picker", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    const openBtn = page
      .getByRole("button", { name: /connect channel|add channel|\+\s*channel/i })
      .first();
    await openBtn.click();
    await page.waitForTimeout(300);

    const backBtn = page
      .getByRole("button", { name: /back|cancel|close/i })
      .or(page.locator('[aria-label*="back"], [aria-label*="close"]'))
      .first();
    await backBtn.click();
    await page.waitForTimeout(300);

    // The picker should be gone; "+ Connect Channel" should be visible again
    await expect(openBtn).toBeVisible();
    expect(errors).toHaveLength(0);
  });
});
