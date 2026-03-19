#!/usr/bin/env node
/**
 * One-time migration: re-encrypt sensitive DB fields from old fallback key
 * to the new NEXUS_DB_SECRET key.
 *
 * Usage: NEXUS_DB_SECRET=<secret> node re-encrypt-db.js
 *
 * The old key is derived from machine identity (hostname:cwd:nexus-fallback).
 */

const crypto = require("crypto");
const os = require("os");
const Database = require("better-sqlite3");
const path = require("path");

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const PREFIX = "enc:v1:";

const DB_PATH = process.env.DATABASE_PATH || "./nexus.db";
const NEW_SECRET = process.env.NEXUS_DB_SECRET;

if (!NEW_SECRET) {
  console.error("ERROR: NEXUS_DB_SECRET environment variable is required.");
  process.exit(1);
}

// Derive old fallback key
const oldSeed = `${os.hostname()}:${process.cwd()}:nexus-fallback`;
const oldKey = crypto.scryptSync(oldSeed, "nexus-fallback-salt", KEY_BYTES);
console.log(`Old key seed: "${oldSeed}"`);

// Derive new key
const newKey = crypto.scryptSync(NEW_SECRET, "nexus-db-salt", KEY_BYTES);
console.log("New key derived from NEXUS_DB_SECRET.\n");

function decrypt(encrypted, key) {
  if (!encrypted || !encrypted.startsWith(PREFIX)) return encrypted;
  const payload = encrypted.slice(PREFIX.length);
  const parts = payload.split(":");
  if (parts.length !== 3) return null;

  const [ivHex, tagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

function encrypt(plaintext, key) {
  if (!plaintext || plaintext === "") return plaintext;
  if (plaintext.startsWith(PREFIX)) return plaintext; // already encrypted
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function reEncryptField(value) {
  if (!value || !value.startsWith(PREFIX)) return { value, changed: false };
  try {
    const plain = decrypt(value, oldKey);
    if (plain === null) return { value, changed: false };
    const reEncrypted = encrypt(plain, newKey);
    return { value: reEncrypted, changed: true };
  } catch {
    console.warn("  ⚠ Could not decrypt with old key — skipping field.");
    return { value, changed: false };
  }
}

// ── Main ──────────────────────────────────────────────────────
const db = new Database(path.resolve(DB_PATH));
let totalUpdated = 0;

// 1. MCP servers: access_token, client_secret
console.log("── MCP Servers ──");
const mcpServers = db.prepare("SELECT id, name, access_token, client_secret FROM mcp_servers").all();
for (const srv of mcpServers) {
  const at = reEncryptField(srv.access_token);
  const cs = reEncryptField(srv.client_secret);
  if (at.changed || cs.changed) {
    db.prepare("UPDATE mcp_servers SET access_token = ?, client_secret = ? WHERE id = ?")
      .run(at.value, cs.value, srv.id);
    console.log(`  ✔ Re-encrypted: ${srv.name} (${srv.id})`);
    totalUpdated++;
  } else {
    console.log(`  – Skipped (not encrypted or already correct): ${srv.name}`);
  }
}

// 2. Channels: config_json, webhook_secret
console.log("\n── Channels ──");
const channels = db.prepare("SELECT id, label, config_json, webhook_secret FROM channels").all();
for (const ch of channels) {
  const cfg = reEncryptField(ch.config_json);
  const ws = reEncryptField(ch.webhook_secret);
  if (cfg.changed || ws.changed) {
    db.prepare("UPDATE channels SET config_json = ?, webhook_secret = ? WHERE id = ?")
      .run(cfg.value, ws.value, ch.id);
    console.log(`  ✔ Re-encrypted: ${ch.label} (${ch.id})`);
    totalUpdated++;
  } else {
    console.log(`  – Skipped: ${ch.label}`);
  }
}

// 3. LLM providers: config_json (if encrypted)
console.log("\n── LLM Providers ──");
const providers = db.prepare("SELECT id, label, config_json FROM llm_providers").all();
for (const p of providers) {
  const cfg = reEncryptField(p.config_json);
  if (cfg.changed) {
    db.prepare("UPDATE llm_providers SET config_json = ? WHERE id = ?").run(cfg.value, p.id);
    console.log(`  ✔ Re-encrypted: ${p.label} (${p.id})`);
    totalUpdated++;
  } else {
    console.log(`  – Skipped: ${p.label}`);
  }
}

// 4. Identity config: password_hash is bcrypt (not encrypted), check for any enc:v1: fields
console.log("\n── Identity Config ──");
const identities = db.prepare("SELECT * FROM identity_config").all();
for (const id of identities) {
  // Check all string columns for enc:v1: prefix
  let changed = false;
  const updates = {};
  for (const [col, val] of Object.entries(id)) {
    if (typeof val === "string" && val.startsWith(PREFIX)) {
      const result = reEncryptField(val);
      if (result.changed) {
        updates[col] = result.value;
        changed = true;
      }
    }
  }
  if (changed) {
    for (const [col, val] of Object.entries(updates)) {
      db.prepare(`UPDATE identity_config SET ${col} = ? WHERE id = ?`).run(val, id.id);
    }
    console.log(`  ✔ Re-encrypted identity: ${id.id}`);
    totalUpdated++;
  } else {
    console.log(`  – Skipped: ${id.id}`);
  }
}

db.close();
console.log(`\n✅ Done. ${totalUpdated} record(s) re-encrypted.`);
