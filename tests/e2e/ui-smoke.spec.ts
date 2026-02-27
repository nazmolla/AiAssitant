import { test, expect, ConsoleMessage, Page } from "@playwright/test";

function collectClientErrors(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  return { pageErrors, consoleErrors };
}

test("sign-in page renders without client-side exceptions", async ({ page }) => {
  const { pageErrors, consoleErrors } = collectClientErrors(page);

  await page.goto("/auth/signin", { waitUntil: "networkidle" });

  await expect(page.getByText("Nexus")).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in with password/i })).toBeVisible();

  const cspViolations = consoleErrors.filter((entry) =>
    entry.toLowerCase().includes("content security policy") ||
    entry.toLowerCase().includes("violates the following")
  );

  expect(pageErrors, `Page errors: ${pageErrors.join(" | ")}`).toEqual([]);
  expect(cspViolations, `CSP console errors: ${cspViolations.join(" | ")}`).toEqual([]);
});

test("root route loads and does not crash the client", async ({ page }) => {
  const { pageErrors, consoleErrors } = collectClientErrors(page);

  await page.goto("/", { waitUntil: "networkidle" });

  await expect(page.locator("body")).toBeVisible();

  const clientCrashSignals = [
    ...pageErrors,
    ...consoleErrors.filter((entry) =>
      entry.toLowerCase().includes("client-side exception") ||
      entry.toLowerCase().includes("application error") ||
      entry.toLowerCase().includes("hydration")
    ),
  ];

  expect(clientCrashSignals, `Client crash signals: ${clientCrashSignals.join(" | ")}`).toEqual([]);
});
