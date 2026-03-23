#!/usr/bin/env node
/**
 * One-shot server-side setup script.
 * - Verifies Ollama is reachable and the model is available
 * - Registers a 'litellm' embedding provider directly in the app DB
 *   (with the same AES-256-GCM encryption the app uses for config_json)
 * - Sets it as the default embedding provider for the application
 *
 * Must be run on the production server from the app directory:
 *   cd ~/AiAssistant && node scripts/setup-ollama-embedding.js
 */

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

// ── Config ───────────────────────────────────────────────────────

const MODEL = "nomic-embed-text";
const OLLAMA_HOST = "localhost";
const OLLAMA_PORT = 11434;
const PROVIDER_LABEL = `Local Ollama (${MODEL})`;

// ── Load .env ────────────────────────────────────────────────────

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

// ── Field encryption (mirrors src/lib/db/crypto.ts) ─────────────

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const ENC_PREFIX = "enc:v1:";

let _masterKey = null;

function getMasterKey() {
  if (_masterKey) return _masterKey;
  const secret = process.env.NEXUS_DB_SECRET;
  if (!secret) {
    throw new Error(
      "NEXUS_DB_SECRET is not set. Cannot encrypt provider config.\n" +
      "Ensure .env contains NEXUS_DB_SECRET or export it before running this script."
    );
  }
  _masterKey = crypto.scryptSync(secret, "nexus-db-salt", KEY_BYTES);
  return _masterKey;
}

function encryptField(plaintext) {
  if (!plaintext) return null;
  if (plaintext.startsWith(ENC_PREFIX)) return plaintext; // already encrypted
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

// ── Locate DB ────────────────────────────────────────────────────

const dbPaths = [
  process.env.DATABASE_PATH,
  path.join(__dirname, "..", "nexus.db"),
  path.join(__dirname, "..", "data", "nexus.db"),
].filter(Boolean).map((p) => path.resolve(p));

const dbPath = dbPaths.find((p) => fs.existsSync(p));
if (!dbPath) {
  console.error("✗ No database file found. Tried:\n" + dbPaths.join("\n"));
  process.exit(1);
}
console.log(`  DB: ${dbPath}`);
const db = new Database(dbPath, { readonly: false });
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

// ── HTTP helper ──────────────────────────────────────────────────

function httpGet(host, port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ method: "GET", host, port, path: urlPath, timeout: 10000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch { resolve({ status: res.statusCode, body: null }); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timed out")); });
    req.end();
  });
}

function httpPost(host, port, urlPath, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request({
      method: "POST", host, port, path: urlPath, timeout: 30000,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch { resolve({ status: res.statusCode, body: null }); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Timed out")); });
    req.write(body);
    req.end();
  });
}

// ── Main ─────────────────────────────────────────────────────────

async function run() {
  // 1. Check Ollama is reachable
  console.log("\n[1/4] Checking Ollama is reachable...");
  try {
    const res = await httpGet(OLLAMA_HOST, OLLAMA_PORT, "/api/tags");
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    const models = (res.body?.models || []).map((m) => m.name);
    const loaded = models.some((m) => m.startsWith(MODEL));
    if (!loaded) {
      console.error(`  ✗ Model '${MODEL}' not found. Available: ${models.join(", ") || "(none)"}`);
      process.exit(1);
    }
    console.log(`  ✓ Ollama running, model '${MODEL}' found`);
  } catch (err) {
    console.error(`  ✗ Cannot reach Ollama at ${OLLAMA_HOST}:${OLLAMA_PORT} — ${err.message}`);
    process.exit(1);
  }

  // 2. Test the embedding endpoint
  console.log("\n[2/4] Testing embedding endpoint...");
  try {
    const res = await httpPost(OLLAMA_HOST, OLLAMA_PORT, "/v1/embeddings", { model: MODEL, input: "test" });
    if (res.status !== 200 || !res.body?.data?.[0]?.embedding?.length) {
      throw new Error(`Unexpected response: HTTP ${res.status}`);
    }
    const dims = res.body.data[0].embedding.length;
    console.log(`  ✓ Embedding endpoint works (${dims} dimensions)`);
  } catch (err) {
    console.error(`  ✗ Embedding test failed: ${err.message}`);
    process.exit(1);
  }

  // 3. Check if already configured
  console.log("\n[3/4] Checking for existing Ollama embedding provider in DB...");
  const existing = db
    .prepare("SELECT id, label FROM llm_providers WHERE purpose = 'embedding' AND provider_type = 'litellm'")
    .all();

  if (existing.length > 0) {
    console.log(`  Found ${existing.length} existing litellm embedding provider(s):`);
    for (const p of existing) console.log(`    - ${p.label} (${p.id})`);
    console.log("  Setting first as default...");
    db.prepare("UPDATE llm_providers SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE purpose = 'embedding'")
      .run(existing[0].id);
    console.log(`  ✓ '${existing[0].label}' is now the default embedding provider`);
    return;
  }

  // 4. Insert provider
  console.log("\n[4/4] Registering provider in DB...");
  const config = JSON.stringify({
    baseURL: `http://${OLLAMA_HOST}:${OLLAMA_PORT}`,
    model: MODEL,
  });
  const encryptedConfig = encryptField(config);
  const id = crypto.randomUUID();

  // Clear any existing default embedding provider
  db.prepare("UPDATE llm_providers SET is_default = 0 WHERE purpose = 'embedding'").run();

  db.prepare(
    `INSERT INTO llm_providers (id, label, provider_type, purpose, config_json, is_default)
     VALUES (?, ?, 'litellm', 'embedding', ?, 1)`
  ).run(id, PROVIDER_LABEL, encryptedConfig);

  const inserted = db.prepare("SELECT id, label, is_default FROM llm_providers WHERE id = ?").get(id);
  if (!inserted) throw new Error("Insert verification failed — row not found after insert");

  console.log(`  ✓ Provider registered: '${inserted.label}' (id: ${inserted.id})`);
  console.log(`  ✓ Set as default embedding provider`);

  console.log("\n✓ Done — Ollama embedding is active.");
  console.log(`  Model:    ${MODEL}`);
  console.log(`  Endpoint: http://${OLLAMA_HOST}:${OLLAMA_PORT}`);
  console.log(`  Dimensions: 768`);
  console.log("  Note: The app picks up the new provider on the next embedding call (no restart needed).");
}

run().catch((err) => {
  console.error(`\n✗ Failed: ${err.message}`);
  process.exit(1);
});
