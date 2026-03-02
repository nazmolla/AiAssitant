import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.USAGE_BASE_URL || "http://localhost:3001";
const EMAIL = process.env.USAGE_EMAIL;
const PASSWORD = process.env.USAGE_PASSWORD;

if (!EMAIL || !PASSWORD) {
  throw new Error("USAGE_EMAIL and USAGE_PASSWORD must be set");
}

const OUTPUT_DIR = path.resolve("docs/images");

async function ensureOutputDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

async function gotoAndSettle(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
}

async function screenshot(page, fileName) {
  await page.waitForTimeout(300);
  await page.screenshot({
    path: path.join(OUTPUT_DIR, fileName),
    fullPage: false,
  });
}

async function openNav(page) {
  const candidates = [
    'button:has(svg[data-testid="MenuIcon"])',
    'header button[title="Open navigation"]',
    "header button",
  ];

  for (const selector of candidates) {
    const el = page.locator(selector).first();
    if (await el.count()) {
      await el.click();
      await page.waitForTimeout(250);
      return;
    }
  }

  throw new Error("Could not find navigation toggle button");
}

async function goMainTab(page, tabLabel) {
  await openNav(page);
  await page.getByRole("button", { name: tabLabel }).click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
}

async function goSettings(page) {
  await goMainTab(page, "Settings");
  await page.waitForSelector("text=Owner Profile", { timeout: 10000 });
}

async function goSettingsChip(page, chipLabelRegex, headerText) {
  await page.getByRole("button", { name: chipLabelRegex }).click();
  await page.waitForSelector(`text=${headerText}`, { timeout: 10000 });
  await page.waitForTimeout(400);
}

async function login(page) {
  await gotoAndSettle(page, `${BASE_URL}/auth/signin`);
  await page.locator('input[name="email"]').fill(EMAIL);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /sign in with password/i }).click();
  await page.waitForURL(`${BASE_URL}/`, { timeout: 15000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
}

async function run() {
  await ensureOutputDir();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1720, height: 980 } });
  const page = await context.newPage();

  try {
    await login(page);

    await screenshot(page, "usage-command-center-overview.png");

    await screenshot(page, "usage-chat.png");

    await goMainTab(page, "Knowledge");
    await screenshot(page, "usage-knowledge.png");

    await goMainTab(page, "Approvals");
    await screenshot(page, "usage-approvals.png");

    await goSettings(page);
    await screenshot(page, "usage-settings-profile.png");

    await goSettingsChip(page, /Providers/i, "LLM Providers");
    await screenshot(page, "usage-settings-providers.png");

    await goSettingsChip(page, /MCP Servers/i, "MCP Servers");
    await screenshot(page, "usage-settings-mcp.png");

    await goSettingsChip(page, /Tool Policies/i, "Tool Policies");
    await screenshot(page, "usage-settings-tool-policies.png");

    await goSettingsChip(page, /Channels/i, "Communication Channels");
    await screenshot(page, "usage-settings-channels.png");

    await goSettingsChip(page, /Alexa/i, "Alexa Smart Home");
    await screenshot(page, "usage-settings-alexa.png");

    await goSettingsChip(page, /Authentication/i, "Authentication Providers");
    await screenshot(page, "usage-settings-authentication.png");

    await goSettingsChip(page, /Users/i, "User Management");
    await screenshot(page, "usage-settings-users.png");

    await goSettingsChip(page, /Custom Tools/i, "Custom Tools");
    await screenshot(page, "usage-settings-custom-tools.png");

    console.log("Usage screenshots captured successfully.");
  } finally {
    await browser.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
