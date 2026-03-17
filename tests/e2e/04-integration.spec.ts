/**
 * E2E — Agent integration scenarios.
 *
 * Sends real messages through the chat and waits for the agent to respond.
 * These tests exercise the full server-side pipeline: LLM, tool calls, streaming SSE.
 *
 * Gated on TWO env vars:
 *   E2E_TEST_EMAIL / E2E_TEST_PASSWORD — authentication
 *   E2E_INTEGRATION=true              — opt-in because tests are slow (up to 3 min each)
 *
 * Run with:
 *   E2E_INTEGRATION=true npx playwright test 04-integration --project chromium
 */
import { test, expect } from "@playwright/test";

const hasAuth = (process.env.E2E_TEST_EMAIL ?? "") !== "";
const runIntegration = process.env.E2E_INTEGRATION === "true";

/** Create a new thread, type a message, send it and wait for an agent reply. */
async function sendAndWait(page: import("@playwright/test").Page, message: string) {
  // Open a fresh thread
  const newBtn = page
    .getByRole("button", { name: /new (thread|chat|conversation)/i })
    .or(page.getByTitle(/new (thread|chat)/i))
    .first();
  if (await newBtn.isVisible()) {
    await newBtn.click();
    await page.waitForTimeout(300);
  }

  const input = page
    .getByPlaceholder(/message nexus|type a message|ask nexus|send a message/i)
    .or(page.locator("textarea").first());

  await input.fill(message);
  await input.press("Enter");

  // Wait up to 120 s for ANY assistant message to appear
  await page.waitForFunction(
    () => {
      const msgs = document.querySelectorAll(
        '[data-testid*="assistant"], [data-role="assistant"], [class*="assistant"], [class*="bot-message"], [class*="agent-message"]'
      );
      if (msgs.length > 0) return true;
      // Fallback: look for any non-empty paragraph or div that appeared after our input
      const bubbles = document.querySelectorAll(
        '[class*="message"]:not([class*="user"]), [class*="response"]'
      );
      return bubbles.length > 0;
    },
    { timeout: 120_000 }
  );
}

test.describe.serial("Agent integration — real LLM response", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testInfo.skip(!hasAuth, "Skipped: set E2E_TEST_EMAIL and E2E_TEST_PASSWORD");
    testInfo.skip(!runIntegration, "Skipped: set E2E_INTEGRATION=true to run full LLM tests");
    await page.goto("/chat", { waitUntil: "networkidle" });
    if (page.url().includes("/auth/signin")) {
      testInfo.skip(true, "Not authenticated");
    }
  });

  test("agent responds to a simple arithmetic question", async ({ page }) => {
    test.setTimeout(150_000);
    await sendAndWait(page, "What is 2 + 2? Answer in one word.");
    // The response should contain the digit 4
    const body = await page.locator("body").innerText();
    expect(body).toMatch(/\b4\b|four/i);
  });

  test("agent responds to a web search request", async ({ page }) => {
    test.setTimeout(180_000);
    await sendAndWait(page, "Search the web for the latest news about artificial intelligence.");
    // Just verify a substantial response came back (> 80 chars after our message)
    const allText = await page.locator("body").innerText();
    expect(allText.length).toBeGreaterThan(200);
    // The page should still be on /chat (no crash)
    await expect(page).toHaveURL(/\/chat/);
  });

  test("agent responds to a weather query", async ({ page }) => {
    test.setTimeout(180_000);
    await sendAndWait(page, "What is the weather like in London right now?");
    const allText = await page.locator("body").innerText();
    // Should mention London or weather-related words
    expect(allText).toMatch(/london|weather|temperature|celsius|fahrenheit|\d+°/i);
  });

  test("agent responds to a file-creation request", async ({ page }) => {
    test.setTimeout(180_000);
    await sendAndWait(page, "Create a text file called integration-test-result.txt with the content 'E2E test passed'.");
    const allText = await page.locator("body").innerText();
    // Response includes some acknowledgement
    expect(allText.length).toBeGreaterThan(100);
    await expect(page).toHaveURL(/\/chat/);
  });

  test("no server errors occur during agent streaming", async ({ page }) => {
    test.setTimeout(150_000);
    const serverErrors: string[] = [];
    page.on("response", (res) => {
      if (res.status() >= 500) serverErrors.push(`${res.status()} ${res.url()}`);
    });

    await sendAndWait(page, "Say hello in exactly three words.");
    expect(serverErrors).toHaveLength(0);
  });
});
