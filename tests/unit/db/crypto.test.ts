/**
 * Unit tests — Column-level encryption (AES-256-GCM)
 */
import { encryptField, decryptField, isEncrypted, _resetMasterKey } from "@/lib/db/crypto";

beforeEach(() => {
  // Reset so each test gets a fresh key derivation
  _resetMasterKey();
});

describe("DB Crypto — encryptField / decryptField", () => {
  test("encrypts and decrypts a string round-trip", () => {
    const original = "my-secret-api-key-12345";
    const encrypted = encryptField(original);
    expect(encrypted).not.toBeNull();
    expect(encrypted).not.toBe(original);
    expect(encrypted!.startsWith("enc:v1:")).toBe(true);
    expect(decryptField(encrypted)).toBe(original);
  });

  test("handles null/undefined/empty passthrough", () => {
    expect(encryptField(null)).toBeNull();
    expect(encryptField(undefined)).toBeNull();
    expect(encryptField("")).toBe("");
    expect(decryptField(null)).toBeNull();
    expect(decryptField(undefined)).toBeNull();
    expect(decryptField("")).toBe("");
  });

  test("does not double-encrypt", () => {
    const original = "secret-value";
    const encrypted = encryptField(original)!;
    const doubleEncrypted = encryptField(encrypted)!;
    expect(doubleEncrypted).toBe(encrypted);
    expect(decryptField(doubleEncrypted)).toBe(original);
  });

  test("returns plaintext as-is if not encrypted (legacy compat)", () => {
    const legacy = "plain-api-key";
    expect(decryptField(legacy)).toBe(legacy);
  });

  test("isEncrypted correctly identifies encrypted values", () => {
    expect(isEncrypted(null)).toBe(false);
    expect(isEncrypted(undefined)).toBe(false);
    expect(isEncrypted("")).toBe(false);
    expect(isEncrypted("plain-value")).toBe(false);
    expect(isEncrypted("enc:v1:abc:def:123")).toBe(true);
    expect(isEncrypted(encryptField("test")!)).toBe(true);
  });

  test("produces unique ciphertext per call (random IV)", () => {
    const original = "same-secret";
    const e1 = encryptField(original);
    const e2 = encryptField(original);
    expect(e1).not.toBe(e2); // different IVs
    expect(decryptField(e1)).toBe(original);
    expect(decryptField(e2)).toBe(original);
  });

  test("handles Unicode and special characters", () => {
    const original = "pässwörd_密码_🔐";
    const encrypted = encryptField(original);
    expect(decryptField(encrypted)).toBe(original);
  });

  test("handles long strings", () => {
    const original = "x".repeat(10000);
    const encrypted = encryptField(original);
    expect(decryptField(encrypted)).toBe(original);
  });

  test("handles JSON config strings", () => {
    const config = JSON.stringify({
      apiKey: "sk-1234567890",
      endpoint: "https://api.openai.com/v1",
      model: "gpt-4",
    });
    const encrypted = encryptField(config);
    expect(decryptField(encrypted)).toBe(config);
    expect(JSON.parse(decryptField(encrypted)!)).toEqual(JSON.parse(config));
  });
});
