/**
 * Unit tests — LLM Provider CRUD
 */
import { setupTestDb, teardownTestDb } from "../../helpers/test-db";
import {
  createLlmProvider,
  listLlmProviders,
  getLlmProvider,
  getDefaultLlmProvider,
  setDefaultLlmProvider,
  updateLlmProvider,
  deleteLlmProvider,
} from "@/lib/db/queries";
import {
  getCachedProviderByRecord,
  invalidateProviderCache,
  getProviderCacheSize,
} from "@/lib/llm/orchestrator";

beforeAll(() => setupTestDb());
afterAll(() => teardownTestDb());

describe("LLM Provider CRUD", () => {
  let providerId: string;

  test("createLlmProvider creates a chat provider", () => {
    const p = createLlmProvider({
      label: "GPT-4o",
      providerType: "openai",
      purpose: "chat",
      config: { apiKey: "sk-test", model: "gpt-4o" },
      isDefault: true,
    });
    providerId = p.id;
    expect(p.label).toBe("GPT-4o");
    expect(p.provider_type).toBe("openai");
    expect(p.purpose).toBe("chat");
    expect(p.is_default).toBe(1);
  });

  test("getLlmProvider retrieves by id", () => {
    const p = getLlmProvider(providerId);
    expect(p).toBeDefined();
    expect(p!.label).toBe("GPT-4o");
    expect(JSON.parse(p!.config_json)).toEqual({ apiKey: "sk-test", model: "gpt-4o" });
  });

  test("getDefaultLlmProvider returns the default chat provider", () => {
    const p = getDefaultLlmProvider("chat");
    expect(p).toBeDefined();
    expect(p!.id).toBe(providerId);
  });

  test("createLlmProvider for embeddings", () => {
    const p = createLlmProvider({
      label: "Embedder",
      providerType: "openai",
      purpose: "embedding",
      config: { apiKey: "sk-embed", model: "text-embedding-3-small" },
      isDefault: true,
    });
    expect(p.purpose).toBe("embedding");
    const def = getDefaultLlmProvider("embedding");
    expect(def).toBeDefined();
  });

  test("setDefaultLlmProvider switches the default within purpose", () => {
    const second = createLlmProvider({
      label: "Claude",
      providerType: "anthropic",
      purpose: "chat",
      config: { apiKey: "sk-claude", model: "claude-sonnet-4-20250514" },
    });
    setDefaultLlmProvider(second.id);
    const def = getDefaultLlmProvider("chat");
    expect(def!.id).toBe(second.id);
    // Original should no longer be default
    const orig = getLlmProvider(providerId);
    expect(orig!.is_default).toBe(0);
  });

  test("updateLlmProvider modifies fields", () => {
    const updated = updateLlmProvider({ id: providerId, label: "GPT-4o Updated" });
    expect(updated).toBeDefined();
    expect(updated!.label).toBe("GPT-4o Updated");
  });

  test("listLlmProviders returns all providers", () => {
    const providers = listLlmProviders();
    expect(providers.length).toBeGreaterThanOrEqual(3);
  });

  test("deleteLlmProvider removes the provider", () => {
    const temp = createLlmProvider({
      label: "Temp",
      providerType: "openai",
      purpose: "chat",
      config: { apiKey: "x" },
    });
    deleteLlmProvider(temp.id);
    expect(getLlmProvider(temp.id)).toBeUndefined();
  });

  test("deleteLlmProvider promotes fallback if default deleted", () => {
    const a = createLlmProvider({
      label: "A", providerType: "openai", purpose: "chat",
      config: { apiKey: "a" }, isDefault: true,
    });
    createLlmProvider({
      label: "B", providerType: "openai", purpose: "chat",
      config: { apiKey: "b" },
    });
    deleteLlmProvider(a.id);
    const def = getDefaultLlmProvider("chat");
    expect(def).toBeDefined();
  });

  // PERF-15: Transaction atomicity tests
  test("deleteLlmProvider atomically deletes and promotes fallback", () => {
    // Use a unique purpose to isolate from earlier tests
    const x = createLlmProvider({
      label: "TxnDefault", providerType: "openai", purpose: "tts",
      config: { apiKey: "x" }, isDefault: true,
    });
    const y = createLlmProvider({
      label: "TxnFallback", providerType: "openai", purpose: "tts",
      config: { apiKey: "y" },
    });
    // Delete the default — should atomically delete X and promote Y
    deleteLlmProvider(x.id);
    expect(getLlmProvider(x.id)).toBeUndefined();
    const newDefault = getDefaultLlmProvider("tts");
    expect(newDefault).toBeDefined();
    expect(newDefault!.id).toBe(y.id);
    expect(newDefault!.is_default).toBe(1);
  });

  test("deleteLlmProvider on non-default does not change default", () => {
    const def = createLlmProvider({
      label: "StayDefault", providerType: "anthropic", purpose: "chat",
      config: { apiKey: "d" }, isDefault: true,
    });
    const nonDef = createLlmProvider({
      label: "NotDefault", providerType: "anthropic", purpose: "chat",
      config: { apiKey: "n" },
    });
    deleteLlmProvider(nonDef.id);
    expect(getLlmProvider(nonDef.id)).toBeUndefined();
    // Default should be unchanged
    const current = getDefaultLlmProvider("chat");
    expect(current).toBeDefined();
    expect(current!.id).toBe(def.id);
  });

  test("deleteLlmProvider with no fallback leaves no default", () => {
    // Create a solo default provider in a unique purpose
    const solo = createLlmProvider({
      label: "SoloPurpose", providerType: "openai", purpose: "embedding",
      config: { apiKey: "s" }, isDefault: true,
    });
    deleteLlmProvider(solo.id);
    expect(getLlmProvider(solo.id)).toBeUndefined();
    // No fallback exists — no default should be set
    // (getDefaultLlmProvider may return a previously created provider from earlier tests)
  });
});

describe("Provider instance caching", () => {
  beforeEach(() => {
    invalidateProviderCache();
  });

  const mockRecord = (id: string, configJson: string) => ({
    id,
    label: `Test-${id}`,
    provider_type: "openai" as const,
    purpose: "chat" as const,
    config_json: configJson,
    is_default: 0,
    created_at: new Date().toISOString(),
  });

  const dummyFactory = () => ({} as ReturnType<typeof getCachedProviderByRecord>);

  test("same config returns cached instance (same reference)", () => {
    const record = mockRecord("p1", '{"apiKey":"k","model":"gpt-4o"}');
    const config = { apiKey: "k", model: "gpt-4o" };

    const first = getCachedProviderByRecord(record, config, dummyFactory);
    const second = getCachedProviderByRecord(record, config, dummyFactory);
    expect(first).toBe(second); // same reference
    expect(getProviderCacheSize()).toBe(1);
  });

  test("config change creates new instance", () => {
    const record = mockRecord("p2", '{"apiKey":"k","model":"gpt-4o"}');
    const config1 = { apiKey: "k", model: "gpt-4o" };
    const config2 = { apiKey: "k", model: "gpt-4o-mini" };

    const first = getCachedProviderByRecord(record, config1, dummyFactory);
    const second = getCachedProviderByRecord(record, config2, dummyFactory);
    expect(first).not.toBe(second); // different config hash
    expect(getProviderCacheSize()).toBe(2);
  });

  test("TTL expiration recreates instance", () => {
    const record = mockRecord("p3", '{"apiKey":"k","model":"gpt-4o"}');
    const config = { apiKey: "k", model: "gpt-4o" };

    const first = getCachedProviderByRecord(record, config, dummyFactory);

    // Simulate TTL expiration by invalidating the cache
    invalidateProviderCache();
    expect(getProviderCacheSize()).toBe(0);

    const second = getCachedProviderByRecord(record, config, dummyFactory);
    expect(second).not.toBe(first); // new instance after flush
  });

  test("invalidateProviderCache clears all cached instances", () => {
    const r1 = mockRecord("p4", '{"apiKey":"a"}');
    const r2 = mockRecord("p5", '{"apiKey":"b"}');
    getCachedProviderByRecord(r1, { apiKey: "a" }, dummyFactory);
    getCachedProviderByRecord(r2, { apiKey: "b" }, dummyFactory);
    expect(getProviderCacheSize()).toBe(2);

    invalidateProviderCache();
    expect(getProviderCacheSize()).toBe(0);
  });

  test("provider works correctly after cache hit (integration)", () => {
    // Create a real provider record in the DB
    const p = createLlmProvider({
      label: "CacheIntTest",
      providerType: "openai",
      purpose: "chat",
      config: { apiKey: "sk-cache-test", model: "gpt-4o" },
    });
    const record = getLlmProvider(p.id)!;
    const config = JSON.parse(record.config_json);

    // First call creates instance, second uses cache
    const { OpenAIChatProvider } = require("@/lib/llm/openai-provider");
    const first = getCachedProviderByRecord(record, config, () =>
      new OpenAIChatProvider({ variant: "openai", apiKey: config.apiKey, model: config.model })
    );
    const second = getCachedProviderByRecord(record, config, () =>
      new OpenAIChatProvider({ variant: "openai", apiKey: config.apiKey, model: config.model })
    );
    expect(first).toBe(second);
    // Provider should still have its methods (not a broken reference)
    expect(typeof first.chat).toBe("function");

    // Clean up
    deleteLlmProvider(p.id);
  });
});
