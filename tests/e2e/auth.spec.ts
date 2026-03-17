/**
 * E2E tests for the sign-in page — interaction-level, not just render.
 *
 * These tests verify:
 * - The sign-in form has functional email and password fields
 * - Submitting with empty fields keeps the user on the sign-in page (no silent redirect)
 * - Submitting with obviously wrong credentials shows an error (not a crash)
 *
 * Does NOT require valid test credentials — all tests use invalid or empty values
 * intentionally to confirm error-path behaviour.
 */
import { test, expect } from "@playwright/test";

test.describe("Sign-in page — form interactions", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/auth/signin", { waitUntil: "networkidle" });
  });

  test("displays email and password inputs and a submit button", async ({ page }) => {
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in with password/i })).toBeVisible();
  });

  test("submitting an empty form does not navigate away from sign-in", async ({ page }) => {
    await page.getByRole("button", { name: /sign in with password/i }).click();
    // Still on sign-in page — email input still present
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/signin/);
  });

  test("submitting with wrong credentials shows an error, not a crash", async ({ page }) => {
    await page.getByLabel(/email/i).fill("nonexistent-user@example.invalid");
    await page.getByLabel(/password/i).fill("definitely-wrong-password-xyz");
    await page.getByRole("button", { name: /sign in with password/i }).click();

    // Should stay on sign-in page, not crash
    await expect(page).toHaveURL(/\/auth\/signin/);

    // Some form of error feedback visible — either inline or a toast
    const errorVisible = await page.locator('[role="alert"], .error, [data-testid*="error"]').first().isVisible().catch(() => false);
    const urlHasError = page.url().includes("error=");
    // One of: inline error message OR URL error param (NextAuth classic redirect)
    expect(errorVisible || urlHasError).toBe(true);
  });

  test("password field masks input by default", async ({ page }) => {
    const passwordInput = page.getByLabel(/password/i);
    await expect(passwordInput).toHaveAttribute("type", "password");
  });

  test("typing in the email field updates its value", async ({ page }) => {
    const emailInput = page.getByLabel(/email/i);
    await emailInput.fill("test@example.com");
    await expect(emailInput).toHaveValue("test@example.com");
  });
});
