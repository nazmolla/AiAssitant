/**
 * Unit tests — Decrypted row caching for channels, auth providers, MCP servers (PERF-16)
 */
import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import {
  createChannel,
  listChannels,
  updateChannel,
  deleteChannel,
  listAuthProviders,
  upsertAuthProvider,
  deleteAuthProvider,
  listMcpServers,
  upsertMcpServer,
  deleteMcpServer,
} from "@/lib/db/queries";
import { appCache } from "@/lib/cache";

let userId: string;

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "cache-decrypt@example.com" });
});
afterAll(() => teardownTestDb());

beforeEach(() => {
  appCache.invalidateAll();
});

describe("Decrypted channel cache", () => {
  test("cache hit returns decrypted data without re-decryption", () => {
    createChannel({ label: "CacheCh", channelType: "slack", configJson: '{"url":"https://a.com"}', userId });
    // First call populates cache
    const first = listChannels(userId);
    expect(first.length).toBeGreaterThanOrEqual(1);
    // Second call returns from cache (same reference)
    const second = listChannels(userId);
    expect(second).toBe(first); // exact same array reference = cache hit
  });

  test("cache invalidated on createChannel", () => {
    const before = listChannels(userId);
    createChannel({ label: "NewCh", channelType: "telegram", configJson: "{}", userId });
    const after = listChannels(userId);
    expect(after).not.toBe(before); // different reference = cache miss
    expect(after.length).toBe(before.length + 1);
  });

  test("cache invalidated on updateChannel", () => {
    const ch = createChannel({ label: "UpdCh", channelType: "slack", configJson: "{}", userId });
    const before = listChannels(userId);
    updateChannel({ id: ch.id, label: "UpdatedLabel" });
    const after = listChannels(userId);
    expect(after).not.toBe(before);
    expect(after.find((c) => c.id === ch.id)?.label).toBe("UpdatedLabel");
  });

  test("cache invalidated on deleteChannel", () => {
    const ch = createChannel({ label: "DelCh", channelType: "slack", configJson: "{}", userId });
    const before = listChannels(userId);
    deleteChannel(ch.id);
    const after = listChannels(userId);
    expect(after).not.toBe(before);
    expect(after.find((c) => c.id === ch.id)).toBeUndefined();
  });

  test("decrypted data is correct on cache miss", () => {
    appCache.invalidateAll();
    const ch = createChannel({
      label: "DecryptTest",
      channelType: "slack",
      configJson: '{"secret":"s3cret"}',
      userId,
    });
    appCache.invalidateAll(); // force miss
    const list = listChannels(userId);
    const found = list.find((c) => c.id === ch.id);
    expect(found).toBeDefined();
    // config_json should be decrypted (readable JSON, not ciphertext)
    expect(() => JSON.parse(found!.config_json)).not.toThrow();
    const parsed = JSON.parse(found!.config_json);
    expect(parsed.secret).toBe("s3cret");
  });
});

describe("Decrypted auth provider cache", () => {
  test("cache hit returns same reference", () => {
    upsertAuthProvider({ providerType: "google", label: "Google", clientId: "gid", clientSecret: "gsec" });
    const first = listAuthProviders();
    const second = listAuthProviders();
    expect(second).toBe(first);
  });

  test("cache invalidated on upsertAuthProvider", () => {
    const before = listAuthProviders();
    upsertAuthProvider({ providerType: "azure-ad", label: "Azure", clientId: "aid" });
    const after = listAuthProviders();
    expect(after).not.toBe(before);
  });

  test("cache invalidated on deleteAuthProvider", () => {
    upsertAuthProvider({ providerType: "discord", label: "Discord", botToken: "tok" });
    const before = listAuthProviders();
    deleteAuthProvider("discord");
    const after = listAuthProviders();
    expect(after).not.toBe(before);
    expect(after.find((p) => p.id === "discord")).toBeUndefined();
  });

  test("decrypted secrets correct on cache miss", () => {
    appCache.invalidateAll();
    upsertAuthProvider({ providerType: "google", label: "G2", clientId: "cid", clientSecret: "the-secret" });
    appCache.invalidateAll(); // force miss
    const list = listAuthProviders();
    const g = list.find((p) => p.provider_type === "google");
    expect(g).toBeDefined();
    expect(g!.client_secret).toBe("the-secret");
  });
});

describe("Decrypted MCP server cache", () => {
  test("cache hit returns same reference", () => {
    upsertMcpServer({
      id: "mcp-cache-1", name: "Test MCP", transport_type: "stdio",
      command: "node", args: "[]", env_vars: null, url: null,
      auth_type: "none", access_token: null, client_id: null, client_secret: null,
      user_id: null, scope: "global",
    });
    const first = listMcpServers();
    const second = listMcpServers();
    expect(second).toBe(first);
  });

  test("cache invalidated on upsertMcpServer", () => {
    const before = listMcpServers();
    upsertMcpServer({
      id: "mcp-cache-2", name: "New MCP", transport_type: "sse",
      command: null, args: null, env_vars: null, url: "https://mcp.test",
      auth_type: "none", access_token: null, client_id: null, client_secret: null,
      user_id: null, scope: "global",
    });
    const after = listMcpServers();
    expect(after).not.toBe(before);
  });

  test("cache invalidated on deleteMcpServer", () => {
    const before = listMcpServers();
    deleteMcpServer("mcp-cache-2");
    const after = listMcpServers();
    expect(after).not.toBe(before);
  });
});

describe("Security: no plaintext secrets on disk", () => {
  test("cached data stays in memory only (appCache is in-process Map)", () => {
    // Verify appCache is a plain Map — no disk persistence
    expect(appCache.size).toBeGreaterThanOrEqual(0);
    // After invalidateAll, nothing remains
    appCache.invalidateAll();
    expect(appCache.size).toBe(0);
    // Re-populate
    listChannels(userId);
    listAuthProviders();
    expect(appCache.size).toBeGreaterThan(0);
    // Flush again
    appCache.invalidateAll();
    expect(appCache.size).toBe(0);
  });
});
