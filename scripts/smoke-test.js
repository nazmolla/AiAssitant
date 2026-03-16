#!/usr/bin/env node
/**
 * Post-deploy functional smoke tests.
 * Runs on the server against localhost:3000 using a temporary API key.
 *
 * Creates a temp API key, exercises core API endpoints, cleans up.
 * Exit 0 = all passed, Exit 1 = failures detected.
 *
 * Usage: node scripts/smoke-test.js
 */

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

// ── Bootstrap DB ────────────────────────────────────────────────
process.env.NODE_ENV = process.env.NODE_ENV || "production";

const dbPaths = Array.from(new Set([
  process.env.DATABASE_PATH,
  path.join(__dirname, "..", "nexus.db"),
  path.join(__dirname, "..", "data", "nexus.db"),
].filter(Boolean).map((p) => path.resolve(p))));

const dbs = dbPaths
  .filter((candidatePath) => fs.existsSync(candidatePath))
  .map((candidatePath) => {
    const handle = new Database(candidatePath, { readonly: false });
    handle.pragma("journal_mode = WAL");
    handle.pragma("busy_timeout = 5000");
    return { path: candidatePath, handle };
  });

if (dbs.length === 0) {
  console.error("  ✗ No SQLite database file found for smoke setup");
  process.exit(1);
}

console.log("  DB candidates:");
for (const dbInfo of dbs) {
  console.log(`    - ${dbInfo.path}`);
}

const BASE = "http://localhost:3000";
let tempKeyId = null;
let tempRawKey = null;
let tempThreadId = null;
let seededKeyRows = [];
let passed = 0;
let failed = 0;

// ── Helpers ─────────────────────────────────────────────────────

function httpRequest(method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tempRawKey}`,
        ...headers,
      },
      timeout: 15000,
    };

    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        let json = null;
        try { json = JSON.parse(raw); } catch { }
        resolve({ status: res.statusCode, body: json, raw });
      });
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });

    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function check(name, condition, details) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
    return;
  }

  console.log(`  ✗ ${name}`);
  if (details) {
    console.log(`    ↳ ${details}`);
  }
  failed++;
}

function detailsFor(res) {
  const bodyPreview = (res.raw || "").slice(0, 300).replace(/\s+/g, " ").trim();
  return `status=${res.status}, body=${bodyPreview || "<empty>"}`;
}

// ── Setup: create temp API key ──────────────────────────────────

function setup() {
  const id = crypto.randomUUID();
  const rawBytes = crypto.randomBytes(16);
  const rawKey = `nxk_${rawBytes.toString("hex")}`;
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.slice(0, 8);
  const scopes = JSON.stringify(["chat", "threads"]);

  seededKeyRows = [];
  for (const dbInfo of dbs) {
    const hasUsersTable = dbInfo.handle
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users' LIMIT 1")
      .get();
    const hasApiKeysTable = dbInfo.handle
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'api_keys' LIMIT 1")
      .get();

    if (!hasUsersTable || !hasApiKeysTable) {
      continue;
    }

    const admin = dbInfo.handle.prepare(
      "SELECT id FROM users WHERE role = 'admin' AND enabled = 1 LIMIT 1"
    ).get();

    if (!admin) {
      continue;
    }

    dbInfo.handle.prepare(
      `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scopes, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+10 minutes'))`
    ).run(id, admin.id, "_smoke_test_temp_", keyHash, keyPrefix, scopes);

    seededKeyRows.push({ dbPath: dbInfo.path, userId: admin.id });
  }

  if (seededKeyRows.length === 0) {
    console.error("  ✗ No enabled admin user found in available DB files — cannot run smoke tests");
    process.exit(1);
  }

  tempKeyId = id;
  tempRawKey = rawKey;
  console.log(`  ✓ Temp API key created in ${seededKeyRows.length} DB file(s) (expires in 10 min)`);
}

// ── Cleanup ─────────────────────────────────────────────────────

function cleanup() {
  try {
    if (tempThreadId) {
      for (const dbInfo of dbs) {
        const hasMessages = dbInfo.handle
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'messages' LIMIT 1")
          .get();
        const hasThreads = dbInfo.handle
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'threads' LIMIT 1")
          .get();
        if (hasMessages) dbInfo.handle.prepare("DELETE FROM messages WHERE thread_id = ?").run(tempThreadId);
        if (hasThreads) dbInfo.handle.prepare("DELETE FROM threads WHERE id = ?").run(tempThreadId);
      }
    }

    if (tempKeyId) {
      for (const dbInfo of dbs) {
        const hasApiKeys = dbInfo.handle
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'api_keys' LIMIT 1")
          .get();
        if (hasApiKeys) dbInfo.handle.prepare("DELETE FROM api_keys WHERE id = ?").run(tempKeyId);
      }
    }

    console.log("  ✓ Cleaned up temp resources");
  } catch (error) {
    console.log(`  ⚠ Cleanup error: ${error.message}`);
  } finally {
    for (const dbInfo of dbs) {
      try {
        dbInfo.handle.close();
      } catch {
      }
    }
  }
}

// ── Tests ───────────────────────────────────────────────────────

async function runTests() {
  const listRes = await httpRequest("GET", "/api/threads");
  check("GET /api/threads returns 200", listRes.status === 200, detailsFor(listRes));
  check("GET /api/threads returns array", Array.isArray(listRes.body && listRes.body.data), detailsFor(listRes));

  const createRes = await httpRequest("POST", "/api/threads", {
    title: "_smoke_test_thread_",
  });
  check("POST /api/threads returns 200/201", createRes.status === 200 || createRes.status === 201, detailsFor(createRes));

  if (createRes.body && createRes.body.id) {
    tempThreadId = createRes.body.id;
    check("Thread has valid id", typeof tempThreadId === "string" && tempThreadId.length > 0);
  } else {
    check("Thread has valid id", false, detailsFor(createRes));
  }

  if (tempThreadId) {
    const getRes = await httpRequest("GET", `/api/threads/${tempThreadId}`);
    check("GET /api/threads/:id returns 200", getRes.status === 200, detailsFor(getRes));
  }

  const knowledgeRes = await httpRequest("GET", "/api/knowledge");
  check(
    "GET /api/knowledge responds (200 or 401)",
    knowledgeRes.status === 200 || knowledgeRes.status === 401 || knowledgeRes.status === 403,
    detailsFor(knowledgeRes)
  );

  const llmRes = await httpRequest("GET", "/api/config/llm");
  check(
    "GET /api/config/llm responds",
    llmRes.status === 200 || llmRes.status === 401 || llmRes.status === 403,
    detailsFor(llmRes)
  );

  const noAuthRes = await new Promise((resolve, reject) => {
    const url = new URL("/api/threads", BASE);
    const req = http.request({
      method: "GET",
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode }));
    });

    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Timeout"));
    });

    req.end();
  });

  check("Unauthenticated request returns 401", noAuthRes.status === 401, `status=${noAuthRes.status}`);
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  console.log("  Running functional smoke tests...");

  try {
    setup();
    await runTests();
  } catch (error) {
    console.log(`  ✗ Smoke test error: ${error.message}`);
    failed++;
  } finally {
    cleanup();
  }

  console.log("");
  console.log(`  Results: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }

  process.exit(0);
}

main();
