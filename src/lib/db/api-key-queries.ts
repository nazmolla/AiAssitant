import crypto from "crypto";
import { v4 as uuid } from "uuid";
import { getDb } from "./connection";
import { stmt } from "./query-helpers";

// ─── API Keys ─────────────────────────────────────────────────

export interface ApiKeyRecord {
  id: string;
  user_id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  scopes: string;       // JSON array
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

/** All valid scopes a key can be granted */
export const API_KEY_SCOPES = ["chat", "knowledge", "approvals", "threads", "logs", "device"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/**
 * Create an API key.  Returns the DB record AND the raw key (shown once).
 * The raw key format is  nxk_<32-hex-chars>  (128-bit entropy).
 */
export function createApiKey(args: {
  userId: string;
  name: string;
  scopes?: ApiKeyScope[];
  expiresAt?: string | null;
}): { record: ApiKeyRecord; rawKey: string } {
  const id = uuid();
  const rawBytes = crypto.randomBytes(16);
  const rawKey = `nxk_${rawBytes.toString("hex")}`;
  const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
  const keyPrefix = rawKey.slice(0, 8);
  const scopes = JSON.stringify(args.scopes ?? ["chat"]);

  getDb()
    .prepare(
      `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scopes, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, args.userId, args.name, keyHash, keyPrefix, scopes, args.expiresAt ?? null);

  return { record: getApiKeyById(id)!, rawKey };
}

export function getApiKeyById(id: string): ApiKeyRecord | undefined {
  return stmt("SELECT * FROM api_keys WHERE id = ?").get(id) as ApiKeyRecord | undefined;
}

/**
 * Look up an API key by its raw key string.
 * Uses the key_prefix for fast DB lookup, then validates the full hash
 * with timing-safe comparison to prevent timing-oracle attacks.
 */
export function getApiKeyByRawKey(rawKey: string): ApiKeyRecord | undefined {
  // Fast-path: reject obvious junk before hitting the DB
  if (!rawKey || rawKey.length < 12) return undefined;

  const prefix = rawKey.slice(0, 8);
  const candidates = stmt("SELECT * FROM api_keys WHERE key_prefix = ?").all(prefix) as ApiKeyRecord[];
  if (candidates.length === 0) return undefined;

  const inputHash = crypto.createHash("sha256").update(rawKey).digest();

  for (const candidate of candidates) {
    const storedHash = Buffer.from(candidate.key_hash, "hex");
    if (storedHash.length === inputHash.length && crypto.timingSafeEqual(inputHash, storedHash)) {
      return candidate;
    }
  }
  return undefined;
}

/** List all API keys for a specific user (safe — never exposes key_hash). */
export function listApiKeys(userId: string): Omit<ApiKeyRecord, "key_hash">[] {
  return stmt(
    "SELECT id, user_id, name, key_prefix, scopes, expires_at, last_used_at, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC"
  ).all(userId) as Omit<ApiKeyRecord, "key_hash">[];
}

/** List all API keys across all users (admin). */
export function listAllApiKeys(): (Omit<ApiKeyRecord, "key_hash"> & { email: string })[] {
  return stmt(
    `SELECT k.id, k.user_id, k.name, k.key_prefix, k.scopes, k.expires_at, k.last_used_at, k.created_at, u.email
     FROM api_keys k JOIN users u ON k.user_id = u.id ORDER BY k.created_at DESC`
  ).all() as (Omit<ApiKeyRecord, "key_hash"> & { email: string })[];
}

/** Update the last_used_at timestamp for a key. */
export function touchApiKey(id: string): void {
  getDb().prepare("UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
}

/** Delete a single API key. */
export function deleteApiKey(id: string): void {
  getDb().prepare("DELETE FROM api_keys WHERE id = ?").run(id);
}

/** Delete all API keys belonging to a user. */
export function deleteApiKeysByUser(userId: string): void {
  getDb().prepare("DELETE FROM api_keys WHERE user_id = ?").run(userId);
}

/** Revoke all expired keys (housekeeping). */
export function revokeExpiredApiKeys(): number {
  const result = getDb()
    .prepare("DELETE FROM api_keys WHERE expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP")
    .run();
  return result.changes;
}
