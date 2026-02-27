/**
 * Column-level encryption for sensitive database fields.
 *
 * Uses AES-256-GCM with a master key derived from the NEXUS_DB_SECRET
 * environment variable.  If no secret is set, a machine-specific fallback
 * key is derived from hostname + cwd so development environments still
 * work out of the box (with a console warning).
 *
 * Encrypted format:  "enc:v1:<iv-hex>:<auth-tag-hex>:<ciphertext-hex>"
 *
 * Functions are no-ops for null / undefined / empty strings so callers
 * don't need to guard every field.
 */

import * as crypto from "crypto";
import * as os from "os";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const PREFIX = "enc:v1:";

// ── Master Key ────────────────────────────────────────────────

let _masterKey: Buffer | null = null;

function getMasterKey(): Buffer {
  if (_masterKey) return _masterKey;

  const envSecret = process.env.NEXUS_DB_SECRET;
  if (envSecret) {
    // Derive a fixed-length key from the user-supplied secret
    _masterKey = crypto.scryptSync(envSecret, "nexus-db-salt", KEY_BYTES);
  } else if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[Nexus Crypto] NEXUS_DB_SECRET is required in production. " +
        "Set NEXUS_DB_SECRET environment variable before starting the application."
    );
  } else {
    // Fallback: derive from machine identity — NOT cryptographically strong
    // but far better than plaintext for unattended / dev setups.
    const seed = `${os.hostname()}:${process.cwd()}:nexus-fallback`;
    _masterKey = crypto.scryptSync(seed, "nexus-fallback-salt", KEY_BYTES);
    if (typeof globalThis !== "undefined" && !(globalThis as any).__nexusCryptoWarned) {
      console.warn(
        "[Nexus Crypto] NEXUS_DB_SECRET is not set. " +
          "Using a machine-derived fallback key. Set NEXUS_DB_SECRET for production."
      );
      (globalThis as any).__nexusCryptoWarned = true;
    }
  }

  return _masterKey;
}

// ── Public API ────────────────────────────────────────────────

/**
 * Encrypt a plaintext string.  Returns the encrypted envelope.
 * Returns null/undefined passthrough for nullable fields.
 */
export function encryptField(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined) {
    return null;
  }
  if (plaintext === "") {
    return plaintext;
  }

  // Already encrypted — don't double-encrypt
  if (plaintext.startsWith(PREFIX)) return plaintext;

  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt an encrypted envelope back to plaintext.
 * If the value is not encrypted (no prefix), returns it as-is
 * to handle legacy plaintext data gracefully.
 */
export function decryptField(encrypted: string | null | undefined): string | null {
  if (encrypted === null || encrypted === undefined) {
    return null;
  }
  if (encrypted === "") {
    return encrypted;
  }

  // Not encrypted — return plaintext as-is (legacy data)
  if (!encrypted.startsWith(PREFIX)) return encrypted;

  const payload = encrypted.slice(PREFIX.length);
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted field");
  }

  const [ivHex, tagHex, ciphertextHex] = parts;
  const key = getMasterKey();
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

/**
 * Check whether a value is already encrypted.
 */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/**
 * Reset cached master key (useful for tests).
 */
export function _resetMasterKey(): void {
  _masterKey = null;
  if (typeof globalThis !== "undefined") {
    delete (globalThis as any).__nexusCryptoWarned;
  }
}
