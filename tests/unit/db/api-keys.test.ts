/**
 * Unit tests — API key CRUD & lookup functions
 */
import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import {
  createApiKey,
  getApiKeyById,
  getApiKeyByRawKey,
  listApiKeys,
  listAllApiKeys,
  deleteApiKey,
  deleteApiKeysByUser,
  touchApiKey,
  revokeExpiredApiKeys,
  API_KEY_SCOPES,
} from "@/lib/db/queries";

beforeAll(() => setupTestDb());
afterAll(() => teardownTestDb());

describe("API Key CRUD", () => {
  let userId: string;
  let rawKey: string;
  let keyId: string;

  beforeAll(() => {
    userId = seedTestUser({ email: "apikey-user@example.com", role: "admin" });
  });

  test("createApiKey returns record + rawKey", () => {
    const result = createApiKey({
      userId,
      name: "Test Key",
      scopes: ["chat", "threads"],
    });

    expect(result.rawKey).toMatch(/^nxk_[a-f0-9]{32}$/);
    expect(result.record).toBeDefined();
    expect(result.record.name).toBe("Test Key");
    expect(result.record.user_id).toBe(userId);
    expect(result.record.key_prefix).toBe(result.rawKey.slice(0, 8));
    expect(JSON.parse(result.record.scopes)).toEqual(["chat", "threads"]);
    expect(result.record.expires_at).toBeNull();

    rawKey = result.rawKey;
    keyId = result.record.id;
  });

  test("getApiKeyById returns the key", () => {
    const key = getApiKeyById(keyId);
    expect(key).toBeDefined();
    expect(key!.id).toBe(keyId);
    expect(key!.name).toBe("Test Key");
  });

  test("getApiKeyByRawKey resolves the key", () => {
    const key = getApiKeyByRawKey(rawKey);
    expect(key).toBeDefined();
    expect(key!.id).toBe(keyId);
  });

  test("getApiKeyByRawKey returns undefined for unknown key", () => {
    expect(getApiKeyByRawKey("nxk_0000000000000000000000000000dead")).toBeUndefined();
  });

  test("listApiKeys returns keys for user", () => {
    const keys = listApiKeys(userId);
    expect(keys.length).toBe(1);
    expect(keys[0].name).toBe("Test Key");
    // Should not include key_hash
    expect((keys[0] as any).key_hash).toBeUndefined();
  });

  test("listAllApiKeys includes email", () => {
    const all = listAllApiKeys();
    expect(all.length).toBeGreaterThanOrEqual(1);
    const found = all.find((k) => k.id === keyId);
    expect(found).toBeDefined();
    expect(found!.email).toBe("apikey-user@example.com");
  });

  test("touchApiKey updates last_used_at", () => {
    touchApiKey(keyId);
    const key = getApiKeyById(keyId);
    expect(key!.last_used_at).not.toBeNull();
  });

  test("deleteApiKey removes the key", () => {
    deleteApiKey(keyId);
    expect(getApiKeyById(keyId)).toBeUndefined();
  });
});

describe("API Key scopes", () => {
  let userId: string;

  beforeAll(() => {
    userId = seedTestUser({ email: "scope-user@example.com" });
  });

  test("default scopes is ['chat']", () => {
    const { record } = createApiKey({ userId, name: "Default Scopes" });
    expect(JSON.parse(record.scopes)).toEqual(["chat"]);
    deleteApiKey(record.id);
  });

  test("all valid scopes can be set", () => {
    const { record } = createApiKey({
      userId,
      name: "All Scopes",
      scopes: [...API_KEY_SCOPES],
    });
    expect(JSON.parse(record.scopes)).toEqual([...API_KEY_SCOPES]);
    deleteApiKey(record.id);
  });
});

describe("API Key expiration", () => {
  let userId: string;

  beforeAll(() => {
    userId = seedTestUser({ email: "expiry-user@example.com" });
  });

  test("key with future expiry is retained by revokeExpiredApiKeys", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const { record } = createApiKey({
      userId,
      name: "Future Key",
      expiresAt: future,
    });
    const purged = revokeExpiredApiKeys();
    expect(purged).toBe(0);
    expect(getApiKeyById(record.id)).toBeDefined();
    deleteApiKey(record.id);
  });

  test("key with past expiry is removed by revokeExpiredApiKeys", () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const { record } = createApiKey({
      userId,
      name: "Expired Key",
      expiresAt: past,
    });
    const purged = revokeExpiredApiKeys();
    expect(purged).toBe(1);
    expect(getApiKeyById(record.id)).toBeUndefined();
  });
});

describe("Bulk operations", () => {
  test("deleteApiKeysByUser removes all keys for a user", () => {
    const uid = seedTestUser({ email: "bulk-user@example.com" });
    createApiKey({ userId: uid, name: "Key A" });
    createApiKey({ userId: uid, name: "Key B" });
    createApiKey({ userId: uid, name: "Key C" });
    expect(listApiKeys(uid).length).toBe(3);

    deleteApiKeysByUser(uid);
    expect(listApiKeys(uid).length).toBe(0);
  });
});
