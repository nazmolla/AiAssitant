import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";

// --- Configuration ---
const PORT = 3099;
const BASE_URL = `http://localhost:${PORT}`;
const TEST_EMAIL = "demo@nexus-agent.local";
const TEST_PASSWORD = "DemoPassword123!";
const TEMP_DB = path.resolve("screenshot-temp.db");
const OUTPUT_DIR = path.resolve("docs/images");

// --- Test data for seeding ---
const TEST_KNOWLEDGE = [
  { entity: "Project", attribute: "name", value: "Nexus Agent" },
  { entity: "Project", attribute: "stack", value: "Next.js, TypeScript, SQLite" },
  { entity: "Team", attribute: "lead", value: "Alex Johnson" },
  { entity: "Server", attribute: "region", value: "US East" },
  { entity: "Deployment", attribute: "method", value: "Automated via deploy.sh" },
];

// --- Helpers ---
async function ensureOutputDir() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
}

async function cleanupTempDb() {
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      await fs.unlink(TEMP_DB + ext);
    } catch {}
  }
}

function startServer() {
  const env = {
    ...process.env,
    DATABASE_PATH: TEMP_DB,
    NEXTAUTH_SECRET: crypto.randomBytes(32).toString("base64"),
    NEXTAUTH_URL: BASE_URL,
    PORT: String(PORT),
  };

  const isWindows = process.platform === "win32";
  const server = spawn(
    isWindows ? "npx" : "npx",
    ["next", "start", "-p", String(PORT)],
    {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
      shell: true,
    }
  );

  server.on("error", (err) => {
    console.error("Server process error:", err.message);
  });

  return server;
}

async function waitForServer(maxRetries = 40) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(`${BASE_URL}/auth/signin`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Server did not become ready");
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
  console.log(`  ✓ ${fileName}`);
}

async function openNav(page) {
  // Check if drawer is already open
  const drawer = page.locator('.MuiDrawer-root');
  if (await drawer.count() && await drawer.first().isVisible()) {
    return; // already open
  }

  const candidates = [
    'button:has(svg[data-testid="MenuIcon"])',
    'header button[title="Open navigation"]',
    "header button",
  ];

  for (const selector of candidates) {
    const el = page.locator(selector).first();
    if (await el.count()) {
      await el.click();
      await page.waitForTimeout(400);
      return;
    }
  }
}

async function closeNav(page) {
  const backdrop = page.locator('.MuiBackdrop-root');
  if (await backdrop.count() && await backdrop.first().isVisible()) {
    await backdrop.first().click();
    await page.waitForTimeout(300);
  }
}

async function goMainTab(page, tabLabel) {
  await closeNav(page); // ensure closed first
  await page.waitForTimeout(200);
  await openNav(page);
  await page.getByRole("button", { name: tabLabel }).click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  // Drawer auto-closes on selection in mobile/responsive mode; wait for it
  await closeNav(page);
}

async function goSettingsChip(page, chipLabelRegex, headerText) {
  await page.getByRole("button", { name: chipLabelRegex }).click();
  await page.waitForTimeout(600);
}

async function login(page) {
  await gotoAndSettle(page, `${BASE_URL}/auth/signin`);
  await page.locator('input[name="email"]').fill(TEST_EMAIL);
  await page.locator('input[name="password"]').fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /sign in with password/i }).click();

  // Sign-in uses redirect: false + router.push("/") — client-side navigation.
  // Poll URL instead of waiting for a "load" event.
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (!page.url().includes("/auth/")) break;
    await page.waitForTimeout(500);
  }

  if (page.url().includes("/auth/")) {
    // Still on auth page — capture debug info
    await page.screenshot({ path: path.join(OUTPUT_DIR, "_debug-login.png") });
    const errorAlert = await page.locator('[role="alert"]').textContent().catch(() => null);
    console.error(`  Login failed. URL: ${page.url()}`);
    if (errorAlert) console.error(`  Error alert: ${errorAlert}`);
    throw new Error("Login failed — still on auth page");
  }

  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1000);
  console.log("  ✓ Logged in");
}

async function seedTestData(page) {
  // Seed knowledge entries
  for (const entry of TEST_KNOWLEDGE) {
    await page.evaluate(async (e) => {
      await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(e),
      });
    }, entry);
  }

  // Send a test message to create a chat thread
  const threadRes = await page.evaluate(async () => {
    const res = await fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Getting started with Nexus" }),
    });
    return res.json();
  });

  if (threadRes?.id) {
    // We just need the thread to exist — actual chat flow requires LLM
    console.log("  ✓ Test thread created");
  }
}

async function run() {
  await ensureOutputDir();
  await cleanupTempDb();

  console.log("Starting temporary server with fresh database...");
  const server = startServer();

  try {
    console.log("Waiting for server to be ready...");
    await waitForServer();
    console.log("Server ready. Capturing screenshots...\n");

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1720, height: 980 } });
    const page = await context.newPage();

    try {
      await login(page);
      await seedTestData(page);

      // Reload to reflect seeded data
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(500);

      // Chat / Command Center
      await screenshot(page, "usage-command-center-overview.png");
      await screenshot(page, "usage-chat.png");

      // Knowledge
      await goMainTab(page, "Knowledge");
      await screenshot(page, "usage-knowledge.png");

      // Approvals (via notification bell or tab)
      try {
        await goMainTab(page, "Approvals");
      } catch {
        // Approvals may not be a main tab — use notification bell area
      }
      await screenshot(page, "usage-approvals.png");

      // Settings → Profile
      await goMainTab(page, "Settings");
      await page.waitForTimeout(600);
      await screenshot(page, "usage-settings-profile.png");

      // Settings sub-pages
      await goSettingsChip(page, /Providers/i, "LLM Providers");
      await screenshot(page, "usage-settings-providers.png");

      await goSettingsChip(page, /MCP/i, "MCP Servers");
      await screenshot(page, "usage-settings-mcp.png");

      await goSettingsChip(page, /Tool Policies/i, "Tool Policies");
      await screenshot(page, "usage-settings-tool-policies.png");

      await goSettingsChip(page, /Channels/i, "Channels");
      await screenshot(page, "usage-settings-channels.png");

      await goSettingsChip(page, /Alexa/i, "Alexa");
      await screenshot(page, "usage-settings-alexa.png");

      await goSettingsChip(page, /Authentication/i, "Authentication");
      await screenshot(page, "usage-settings-authentication.png");

      await goSettingsChip(page, /Users/i, "Users");
      await screenshot(page, "usage-settings-users.png");

      await goSettingsChip(page, /Custom Tools/i, "Custom Tools");
      await screenshot(page, "usage-settings-custom-tools.png");

      console.log("\n✓ All usage screenshots captured successfully.");
    } finally {
      await browser.close();
    }
  } finally {
    server.kill();
    await new Promise((r) => setTimeout(r, 1000));
    await cleanupTempDb();
    console.log("Temporary database cleaned up.");
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
