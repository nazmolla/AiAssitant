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
const path = require("path");

// ── Bootstrap DB ────────────────────────────────────────────────
process.env.NODE_ENV = process.env.NODE_ENV || "production";
const dbPath = path.join(__dirname, "..", "nexus.db");
const Database = require("better-sqlite3");
const db = new Database(dbPath, { readonly: false });
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

const BASE = "http://localhost:3000";
let tempKeyId = null;
let tempRawKey = null;
let tempThreadId = null;
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
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf-8");
        let json = null;
        try { json = JSON.parse(raw); } catch { /* not JSON */ }
        resolve({ status: res.statusCode, body: json, raw });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Request timed out")); });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function check(name, condition) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}`);
    failed++;
  }
}

// ── Setup: create temp API key ──────────────────────────────────

function setup() {
  // Find the first admin user
  const admin = db.prepare(
    "SELECT id FROM users WHERE role = 'admin' AND enabled = 1 LIMIT 1"
  ).get();
  if (!admin) {
    console.error("  ✗ No enabled admin user found — cannot run smoke tests");
    process.exit(1);
  }

  const id = crypto.randomUUID();
  const rawBytes = crypto.randomBytes(16);
  const rawKey = `nxk_${rawBytes.toString("hex")}`;
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.slice(0, 8);
  const scopes = JSON.stringify(["chat", "threads"]);

  db.prepare(
    `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scopes, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+10 minutes'))`
  ).run(id, admin.id, "_smoke_test_temp_", keyHash, keyPrefix, scopes);

  tempKeyId = id;
  tempRawKey = rawKey;
  console.log(`  ✓ Temp API key created (expires in 10 min)`);
}

// ── Cleanup ─────────────────────────────────────────────────────

function cleanup() {
  try {
    if (tempThreadId) {
      db.prepare("DELETE FROM messages WHERE thread_id = ?").run(tempThreadId);
      db.prepare("DELETE FROM threads WHERE id = ?").run(tempThreadId);
    }
    if (tempKeyId) {
      db.prepare("DELETE FROM api_keys WHERE id = ?").run(tempKeyId);
    }
    console.log("  ✓ Cleaned up temp resources");
  } catch (e) {
    console.log(`  ⚠ Cleanup error: ${e.message}`);
  }
}

// ── Tests ───────────────────────────────────────────────────────

async function runTests() {
  // 1. GET /api/threads — list threads
  const listRes = await httpRequest("GET", "/api/threads");
  check("GET /api/threads returns 200", listRes.status === 200);
  check("GET /api/threads returns array", Array.isArray(listRes.body));

  // 2. POST /api/threads — create a thread
  const createRes = await httpRequest("POST", "/api/threads", {
    title: "_smoke_test_thread_",
  });
  check("POST /api/threads returns 200/201", createRes.status === 200 || createRes.status === 201);
  if (createRes.body && createRes.body.id) {
    tempThreadId = createRes.body.id;
    check("Thread has valid id", typeof tempThreadId === "string" && tempThreadId.length > 0);
  } else {
    check("Thread has valid id", false);
  }

  // 3. GET /api/threads/:id — fetch the new thread
  if (tempThreadId) {
    const getRes = await httpRequest("GET", `/api/threads/${tempThreadId}`);
    check("GET /api/threads/:id returns 200", getRes.status === 200);
  }

  // 4. GET /api/knowledge — knowledge endpoint responds
  const knowledgeRes = await httpRequest("GET", "/api/knowledge");
  check("GET /api/knowledge responds (200 or 401)", knowledgeRes.status === 200 || knowledgeRes.status === 401 || knowledgeRes.status === 403);

  // 5. GET /api/config/llm — LLM config accessible
  const llmRes = await httpRequest("GET", "/api/config/llm");
  check("GET /api/config/llm responds", llmRes.status === 200 || llmRes.status === 401 || llmRes.status === 403);

  // 6. Verify auth rejection without key
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
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode }));
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timeout")); });
    req.end();
  });
  check("Unauthenticated request returns 401", noAuthRes.status === 401);
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  console.log("  Running functional smoke tests...");

  try {
    setup();
    await runTests();
  } catch (err) {
    console.log(`  ✗ Smoke test error: ${err.message}`);
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
