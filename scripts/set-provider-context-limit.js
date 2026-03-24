#!/usr/bin/env node
/**
 * One-shot script: add or update `maxContextTokens` in a provider's config_json.
 *
 * This enables context-aware fallback routing — the orchestrator skips providers
 * whose maxContextTokens is smaller than the current request's estimated token
 * count, preventing 413 / TPM-exceeded errors on free-tier providers like Groq.
 *
 * Usage (run on the production server from the app directory):
 *   node scripts/set-provider-context-limit.js --label "Groq Llama (free)" --tokens 12000
 *   node scripts/set-provider-context-limit.js --label "DeepSeek" --tokens 64000
 *
 * The script is idempotent — safe to re-run.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

// ── Parse args ───────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : null;
}

const label = getArg("--label");
const tokensRaw = getArg("--tokens");

if (!label || !tokensRaw) {
  console.error("Usage: node set-provider-context-limit.js --label <name> --tokens <number>");
  process.exit(1);
}
const maxContextTokens = parseInt(tokensRaw, 10);
if (!Number.isFinite(maxContextTokens) || maxContextTokens <= 0) {
  console.error(`✗ Invalid --tokens value: ${tokensRaw}`);
  process.exit(1);
}

// ── Load .env ────────────────────────────────────────────────

const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

// ── Encryption (mirrors src/lib/db/crypto.ts) ────────────────

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const ENC_PREFIX = "enc:v1:";

let _key = null;
function getMasterKey() {
  if (_key) return _key;
  const secret = process.env.NEXUS_DB_SECRET;
  if (!secret) throw new Error("NEXUS_DB_SECRET not set");
  _key = crypto.scryptSync(secret, "nexus-db-salt", KEY_BYTES);
  return _key;
}

function decryptField(ciphertext) {
  if (!ciphertext || !ciphertext.startsWith(ENC_PREFIX)) return ciphertext;
  const rest = ciphertext.slice(ENC_PREFIX.length);
  const [ivHex, tagHex, dataHex] = rest.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("Malformed encrypted field");
  const key = getMasterKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return decipher.update(dataHex, "hex", "utf8") + decipher.final("utf8");
}

function encryptField(plaintext) {
  if (!plaintext) return null;
  if (plaintext.startsWith(ENC_PREFIX)) return plaintext;
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

// ── Locate DB ────────────────────────────────────────────────

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
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");

// ── Update provider ──────────────────────────────────────────

const provider = db.prepare("SELECT id, label, config_json FROM llm_providers WHERE label = ? AND purpose = 'chat'").get(label);
if (!provider) {
  console.error(`✗ No chat provider found with label "${label}". Available labels:`);
  const all = db.prepare("SELECT label FROM llm_providers WHERE purpose = 'chat'").all();
  for (const p of all) console.error(`    - ${p.label}`);
  process.exit(1);
}

let config = {};
try {
  const decrypted = decryptField(provider.config_json);
  config = decrypted ? JSON.parse(decrypted) : {};
} catch (err) {
  console.error(`✗ Failed to decrypt config_json for "${label}": ${err.message}`);
  process.exit(1);
}

const prev = config.maxContextTokens;
config.capabilities = config.capabilities || {};
config.capabilities.maxContextTokens = maxContextTokens;
// Also set at the top level for older code paths
config.maxContextTokens = maxContextTokens;

const newEncrypted = encryptField(JSON.stringify(config));
db.prepare("UPDATE llm_providers SET config_json = ? WHERE id = ?").run(newEncrypted, provider.id);

console.log(`\n✓ Updated "${label}" (id: ${provider.id})`);
if (prev !== undefined) {
  console.log(`  maxContextTokens: ${prev} → ${maxContextTokens}`);
} else {
  console.log(`  maxContextTokens: (not set) → ${maxContextTokens}`);
}
console.log("  No restart required — provider config is re-read on each request.\n");
