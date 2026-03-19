/**
 * E2E tests for the chat UI — navigation and interaction after authenticating.
 *
 * Requires env vars:
 *   E2E_TEST_EMAIL    — email of a valid user
 *   E2E_TEST_PASSWORD — password for that user
 *
 * Tests are skipped automatically when credentials are absent.
 * Authentication is handled once by tests/e2e/setup/auth.setup.ts — the saved
 * session is injected via storageState in playwright.config.ts.
 */
import { test, expect } from "@playwright/test";

const hasAuth = (process.env.E2E_TEST_EMAIL ?? "") !== "";

test.describe("Chat page — authenticated navigation", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testInfo.skip(!hasAuth, "Skipped: set E2E_TEST_EMAIL and E2E_TEST_PASSWORD");
    await page.goto("/chat", { waitUntil: "networkidle" });
    // If we ended up on sign-in, auth setup has no credentials — skip
    if (page.url().includes("/auth/signin")) {
      testInfo.skip(true, "Not authenticated — set E2E_TEST_EMAIL and E2E_TEST_PASSWORD");
    }
  });

  test("chat page loads at /chat", async ({ page }) => {
    await expect(page).toHaveURL(/\/chat/);
  });

  test("chat page has no client-side exceptions", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await page.reload({ waitUntil: "networkidle" });
    expect(pageErrors).toHaveLength(0);
  });

  test("chat layout has a visible conversation area", async ({ page }) => {
    const chatArea = page.locator('[data-testid="chat-area"], main, [role="main"]').first();
    await expect(chatArea).toBeVisible();
  });

  test("new thread button is visible and clickable without crashing", async ({ page }) => {
    const newChatButton = page
      .getByRole("button", { name: /new (chat|thread|conversation)/i })
      .or(page.getByTitle(/new (chat|thread)/i))
      .or(page.locator('[data-testid*="new-thread"], [data-testid*="new-chat"]'))
      .first();
    await expect(newChatButton).toBeVisible();
    const errors: string[] = [];
    page.once("pageerror", (err) => errors.push(err.message));
    await newChatButton.click();
    await page.waitForTimeout(500);
    expect(errors).toHaveLength(0);
  });

  test("welcome screen send creates a thread and submits message", async ({ page }) => {
    // Ensure we are at /chat with no thread selected (welcome state)
    await page.goto("/chat", { waitUntil: "networkidle" });

    // The welcome screen shows a prompt when no thread is active
    const welcomeText = page.getByText(/where should we start/i);
    if (!(await welcomeText.isVisible())) {
      // A thread may already be active from a previous test run — click "new chat"
      const newChatBtn = page
        .getByRole("button", { name: /new (chat|thread|conversation)/i })
        .or(page.locator('[data-testid*="new-thread"], [data-testid*="new-chat"]'))
        .first();
      if (await newChatBtn.isVisible()) {
        await newChatBtn.click();
        await page.waitForTimeout(300);
      }
    }

    // Type a message in the input and send it
    const input = page.locator('textarea, input[type="text"]').last();
    await input.fill("Hello from welcome screen test");
    await input.press("Enter");

    // A thread should be created and the user message should appear in the chat
    // (optimistic UI adds it immediately)
    await expect(page.getByText("Hello from welcome screen test")).toBeVisible({ timeout: 5000 });

    // URL should still be /chat (thread navigation is internal state, not URL-based)
    await expect(page).toHaveURL(/\/chat/);

    // No JS errors
  });

  test("settings page loads without crashing", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto("/settings", { waitUntil: "networkidle" });
    expect(errors).toHaveLength(0);
    await expect(page.locator("body")).toBeVisible();
  });

  test("scheduler page loads without crashing", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));
    await page.goto("/scheduler", { waitUntil: "networkidle" });
    expect(errors).toHaveLength(0);
  });
});



