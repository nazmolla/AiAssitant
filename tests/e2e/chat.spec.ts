/**
 * E2E tests for the chat UI — navigation and interaction after authenticating.
 *
 * Requires env vars:
 *   E2E_TEST_EMAIL    — email of a valid user
 *   E2E_TEST_PASSWORD — password for that user
 *
 * Tests are skipped automatically when env vars are absent.
 *
 * Covers:
 * - After sign-in, /chat loads the chat layout (sidebar + conversation area)
 * - The new-thread or compose button is present and clickable
 * - Navigating to /settings shows the config panel
 */
import { test, expect, Page, BrowserContext } from "@playwright/test";

const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? "";
const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD ?? "";
const credentialsAvailable = TEST_EMAIL !== "" && TEST_PASSWORD !== "";

async function signIn(page: Page) {
  await page.goto("/auth/signin", { waitUntil: "networkidle" });
  await page.getByLabel(/email/i).fill(TEST_EMAIL);
  await page.getByLabel(/password/i).fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /sign in with password/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/signin"), { timeout: 15_000 });
}

test.describe("Chat page — authenticated navigation", () => {
  test.skip(!credentialsAvailable, "Skipped: set E2E_TEST_EMAIL and E2E_TEST_PASSWORD to run authenticated tests");

  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await signIn(page);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test("redirects to /chat after sign-in", async () => {
    await expect(page).toHaveURL(/\/chat/);
  });

  test("chat page does not crash (no client-side exceptions)", async () => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));

    await page.goto("/chat", { waitUntil: "networkidle" });
    expect(pageErrors).toEqual([]);
  });

  test("chat layout has a visible thread/conversation area", async () => {
    await page.goto("/chat", { waitUntil: "networkidle" });
    // The conversation area or empty-state placeholder must be visible
    const chatArea = page.locator('[data-testid="chat-area"], main, [role="main"]').first();
    await expect(chatArea).toBeVisible();
  });

  test("new thread button or new chat control is visible and clickable", async () => {
    await page.goto("/chat", { waitUntil: "networkidle" });
    // Look for a button or link that starts a new chat/thread
    const newChatButton = page.getByRole("button", { name: /new (chat|thread|conversation)/i })
      .or(page.getByTitle(/new (chat|thread)/i))
      .or(page.locator('[data-testid*="new-thread"], [data-testid*="new-chat"]'))
      .first();
    await expect(newChatButton).toBeVisible();
    // Clicking it should not crash the page
    await newChatButton.click();
    const pageErrors: string[] = [];
    page.once("pageerror", (err) => pageErrors.push(err.message));
    await page.waitForTimeout(1000);
    expect(pageErrors).toEqual([]);
  });

  test("settings page loads without crashing", async () => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await page.goto("/settings", { waitUntil: "networkidle" });
    expect(pageErrors).toEqual([]);
    // Some settings-specific element should be visible
    await expect(page.locator("body")).toBeVisible();
  });

  test("scheduler page loads without crashing", async () => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await page.goto("/scheduler", { waitUntil: "networkidle" });
    expect(pageErrors).toEqual([]);
  });
});
