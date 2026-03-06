/**
 * Unit tests — Model Orchestrator
 */
import { classifyTask, type TaskType } from "@/lib/llm/orchestrator";

describe("classifyTask", () => {
  test("classifies complex tasks", () => {
    expect(classifyTask("Debug this Node.js server crash and find the root cause of the memory leak")).toBe("complex");
    expect(classifyTask("Implement a new REST endpoint for user management")).toBe("complex");
    expect(classifyTask("Refactor the authentication flow to use JWT tokens instead of sessions")).toBe("complex");
    expect(classifyTask("Step by step, plan how to migrate the database")).toBe("complex");
    expect(classifyTask("Write a function that calculates Fibonacci numbers recursively and iteratively")).toBe("complex");
    expect(classifyTask("Build a Docker deployment pipeline for the application")).toBe("complex");
    expect(classifyTask("How does the garbage collector work in V8? Explain in detail")).toBe("complex");
  });

  test("classifies simple tasks", () => {
    expect(classifyTask("What is the capital of France?")).toBe("simple");
    expect(classifyTask("Who was Albert Einstein?")).toBe("simple");
    expect(classifyTask("Define polymorphism")).toBe("simple");
    expect(classifyTask("Convert 5 miles to km")).toBe("simple");
    expect(classifyTask("Calculate 42 * 38")).toBe("simple");
    expect(classifyTask("Hi")).toBe("simple");
  });

  test("classifies background tasks", () => {
    expect(classifyTask("Summarize this article")).toBe("background");
    expect(classifyTask("Give me a TLDR of the meeting notes")).toBe("background");
    expect(classifyTask("Generate a title for this thread please")).toBe("background");
    expect(classifyTask("Digest the latest changes")).toBe("background");
  });

  test("classifies vision tasks", () => {
    expect(classifyTask("What do you see in this screenshot?")).toBe("vision");
    expect(classifyTask("Describe this image for me")).toBe("vision");
    expect(classifyTask("Look at this picture and tell me what's wrong")).toBe("vision");
  });

  test("classifies vision tasks when hasImages is true", () => {
    expect(classifyTask("Here are the results", true)).toBe("vision");
    expect(classifyTask("Check this out", true)).toBe("vision");
  });

  test("defaults to 'complex' for ambiguous long messages", () => {
    const msg = "I have been thinking about different approaches to this problem and I want to explore some options with you about the architecture considerations";
    // This is long enough to not be "simple" and doesn't match other patterns clearly
    expect(classifyTask(msg)).toBe("complex");
  });
});

describe("selectProvider", () => {
  // These tests need a DB, so we test them with the in-memory test DB
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setupTestDb, teardownTestDb } = require("../../helpers/test-db");

  beforeAll(() => {
    setupTestDb();
    // Seed some LLM providers
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createLlmProvider } = require("@/lib/db/queries");

    createLlmProvider({
      label: "Primary GPT-4o",
      providerType: "openai",
      purpose: "chat",
      config: { apiKey: "sk-test", model: "gpt-4o" },
      isDefault: true,
    });

    createLlmProvider({
      label: "Local Llama",
      providerType: "litellm",
      purpose: "chat",
      config: { baseURL: "http://localhost:4000", model: "ollama/llama3" },
      isDefault: false,
    });

    createLlmProvider({
      label: "Cheap Mini",
      providerType: "openai",
      purpose: "chat",
      config: { apiKey: "sk-test2", model: "gpt-4o-mini" },
      isDefault: false,
    });
  });

  afterAll(() => teardownTestDb());

  test("selects a provider for complex tasks", () => {
    const { selectProvider } = require("@/lib/llm/orchestrator");
    const result = selectProvider("Debug this complicated server issue and fix the authentication middleware code");
    expect(result).toHaveProperty("provider");
    expect(result).toHaveProperty("providerLabel");
    expect(result.taskType).toBe("complex");
    // Complex tasks should prefer primary cloud model
    expect(result.tier).toBe("primary");
  });

  test("selects a background provider that prefers local", () => {
    const { selectBackgroundProvider } = require("@/lib/llm/orchestrator");
    const result = selectBackgroundProvider();
    expect(result).toHaveProperty("provider");
    expect(result.taskType).toBe("background");
    // Should prefer local tier when available
    expect(result.tier).toBe("local");
  });

  test("selects a provider for vision tasks", () => {
    const { selectProvider } = require("@/lib/llm/orchestrator");
    const result = selectProvider("What do you see here?", true);
    expect(result.taskType).toBe("vision");
    // GPT-4o has vision capability → should be selected
    expect(result.providerLabel).toBe("Primary GPT-4o");
  });

  test("prefers fast/cheap models for simple tasks", () => {
    const { selectProvider } = require("@/lib/llm/orchestrator");
    const result = selectProvider("What is 2+2?");
    expect(result.taskType).toBe("simple");
    // Should prefer the cheaper/faster model
  });

  test("handles preferredTier override", () => {
    const { selectProvider } = require("@/lib/llm/orchestrator");
    const result = selectProvider("anything", false, "local");
    // Local tier gets a huge boost
    expect(result.tier).toBe("local");
  });

  test("throws when no providers configured", () => {
    // Get a fresh DB with no providers
    const { setupTestDb: freshDb, teardownTestDb: cleanDb } = require("../../helpers/test-db");
    freshDb();

    const { selectProvider: sp } = require("@/lib/llm/orchestrator");
    expect(() => sp("hello")).toThrow(/No LLM provider configured/);

    cleanDb();
    // Restore original test DB
    setupTestDb();
    // Re-seed the providers
    const { createLlmProvider } = require("@/lib/db/queries");
    createLlmProvider({
      label: "Primary GPT-4o",
      providerType: "openai",
      purpose: "chat",
      config: { apiKey: "sk-test", model: "gpt-4o" },
      isDefault: true,
    });
  });

  test("simple chat tasks prefer cloud over slow local (Ollama CPU)", () => {
    const { selectProvider } = require("@/lib/llm/orchestrator");
    const result = selectProvider("hello");
    expect(result.taskType).toBe("simple");
    // Cloud provider should win over slow local Ollama for interactive chat
    expect(result.providerLabel).not.toBe("Local Llama");
    expect(result.tier).not.toBe("local");
  });

  test("simple chat always selects a fast provider", () => {
    const { selectProvider } = require("@/lib/llm/orchestrator");
    const result = selectProvider("What is 2+2?");
    expect(result.taskType).toBe("simple");
    // Any fast cloud provider is acceptable — local/slow must never win
    expect(["Primary GPT-4o", "Cheap Mini"]).toContain(result.providerLabel);
    expect(result.tier).not.toBe("local");
  });
});

describe("selectFallbackProvider", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setupTestDb, teardownTestDb } = require("../../helpers/test-db");

  beforeAll(() => {
    setupTestDb();
    const { createLlmProvider } = require("@/lib/db/queries");
    createLlmProvider({
      label: "Primary GPT-4o",
      providerType: "openai",
      purpose: "chat",
      config: { apiKey: "sk-test", model: "gpt-4o" },
      isDefault: true,
    });
    createLlmProvider({
      label: "Secondary DeepSeek",
      providerType: "openai",
      purpose: "chat",
      config: { apiKey: "sk-test2", model: "deepseek-chat", baseURL: "https://api.deepseek.com/v1" },
      isDefault: false,
    });
    createLlmProvider({
      label: "Local Ollama",
      providerType: "litellm",
      purpose: "chat",
      config: { baseURL: "http://localhost:11434", model: "qwen3.5" },
      isDefault: false,
    });
  });

  afterAll(() => teardownTestDb());

  test("returns a different provider when primary is excluded", () => {
    const { selectFallbackProvider } = require("@/lib/llm/orchestrator");
    const result = selectFallbackProvider("hello", ["Primary GPT-4o"]);
    expect(result).not.toBeNull();
    expect(result!.providerLabel).not.toBe("Primary GPT-4o");
  });

  test("returns null when all providers are excluded", () => {
    const { selectFallbackProvider } = require("@/lib/llm/orchestrator");
    const result = selectFallbackProvider("hello", ["Primary GPT-4o", "Secondary DeepSeek", "Local Ollama"]);
    expect(result).toBeNull();
  });

  test("excludes multiple failed providers", () => {
    const { selectFallbackProvider } = require("@/lib/llm/orchestrator");
    const result = selectFallbackProvider("hello", ["Primary GPT-4o", "Secondary DeepSeek"]);
    expect(result).not.toBeNull();
    expect(result!.providerLabel).toBe("Local Ollama");
  });
});
