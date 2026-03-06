/**
 * Unit tests — Worker Manager + Loop Worker
 *
 * Validates:
 * - isWorkerAvailable() correctly detects presence/absence of worker script
 * - runLlmInWorker() properly handles worker IPC messages
 * - runAgentLoopWithWorker() falls back to main thread on failure/continuation
 * - Worker abort mechanism works
 * - Timeout handling works
 */

/* ── Mock dependencies ─────────────────────────────────────────────── */

// Mock worker_threads
const mockPostMessage = jest.fn();
const mockTerminate = jest.fn();
const mockOn = jest.fn();

class MockWorker {
  postMessage = mockPostMessage;
  terminate = mockTerminate;
  on = mockOn;

  constructor(_scriptPath: string) {
    // Store for test access
    MockWorker.lastInstance = this;
  }

  static lastInstance: MockWorker | null = null;

  // Helper to simulate messages from the worker
  simulateMessage(msg: unknown) {
    const messageHandler = mockOn.mock.calls.find(
      ([event]: [string]) => event === "message"
    );
    if (messageHandler) {
      messageHandler[1](msg);
    }
  }

  simulateError(err: Error) {
    const errorHandler = mockOn.mock.calls.find(
      ([event]: [string]) => event === "error"
    );
    if (errorHandler) {
      errorHandler[1](err);
    }
  }

  simulateExit(code: number) {
    const exitHandler = mockOn.mock.calls.find(
      ([event]: [string]) => event === "exit"
    );
    if (exitHandler) {
      exitHandler[1](code);
    }
  }
}

jest.mock("worker_threads", () => ({
  Worker: MockWorker,
  isMainThread: true,
  parentPort: null,
}));

// Mock fs for isWorkerAvailable
jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(),
}));

// Mock DB functions
jest.mock("@/lib/db", () => ({
  addLog: jest.fn(),
  addMessage: jest.fn(() => ({
    id: "msg-1",
    thread_id: "thread-1",
    role: "user",
    content: "test",
    created_at: new Date().toISOString(),
  })),
  getThreadMessages: jest.fn(() => []),
  getThread: jest.fn(() => ({ id: "thread-1", title: "New Thread", user_id: "user-1" })),
  updateThreadTitle: jest.fn(),
  addAttachment: jest.fn(),
  getUserProfile: jest.fn(() => null),
  getUserById: jest.fn(() => ({ id: "user-1", role: "admin" })),
  listToolPolicies: jest.fn(() => []),
}));

// Mock knowledge
jest.mock("@/lib/knowledge/retriever", () => ({
  retrieveKnowledge: jest.fn(async () => []),
  hasKnowledgeEntries: jest.fn(() => false),
}));
jest.mock("@/lib/knowledge", () => ({
  ingestKnowledgeFromText: jest.fn(async () => {}),
}));

// Mock MCP
jest.mock("@/lib/mcp", () => ({
  getMcpManager: () => ({
    getAllTools: () => [],
    callTool: jest.fn(async () => ({ content: "result" })),
  }),
}));

// Mock orchestrator
jest.mock("@/lib/llm/orchestrator", () => ({
  selectProvider: jest.fn(() => ({
    provider: {
      chat: jest.fn(async () => ({
        content: "test response",
        toolCalls: [],
      })),
    },
    providerLabel: "test-provider",
    taskType: "simple",
    tier: "primary",
    reason: "test",
  })),
  selectProviderForWorker: jest.fn(() => ({
    provider: {
      chat: jest.fn(async () => ({
        content: "test response",
        toolCalls: [],
      })),
    },
    providerLabel: "test-provider",
    taskType: "simple",
    tier: "primary",
    reason: "test",
    providerType: "openai",
    providerConfig: {
      apiKey: "sk-test",
      model: "gpt-4",
    },
  })),
  selectBackgroundProvider: jest.fn(() => ({
    provider: {
      chat: jest.fn(async () => ({
        content: "Test Title",
        toolCalls: [],
      })),
    },
  })),
  classifyTask: jest.fn(() => "simple"),
}));

// Mock LLM index
jest.mock("@/lib/llm", () => ({
  selectProvider: jest.fn(),
  selectProviderForWorker: jest.fn(() => ({
    provider: { chat: jest.fn() },
    providerLabel: "test",
    taskType: "simple",
    tier: "primary",
    reason: "test",
    providerType: "openai",
    providerConfig: { apiKey: "sk-test", model: "gpt-4" },
  })),
  selectBackgroundProvider: jest.fn(() => ({
    provider: { chat: jest.fn(async () => ({ content: "Title", toolCalls: [] })) },
  })),
  createChatProvider: jest.fn(),
}));

// Mock agent tool modules
jest.mock("@/lib/agent/web-tools", () => ({
  BUILTIN_WEB_TOOLS: [],
  isBuiltinWebTool: () => false,
  executeBuiltinWebTool: jest.fn(),
}));
jest.mock("@/lib/agent/browser-tools", () => ({
  BUILTIN_BROWSER_TOOLS: [],
  isBrowserTool: () => false,
  executeBrowserTool: jest.fn(),
}));
jest.mock("@/lib/agent/fs-tools", () => ({
  BUILTIN_FS_TOOLS: [],
  isFsTool: () => false,
  executeBuiltinFsTool: jest.fn(),
}));
jest.mock("@/lib/agent/network-tools", () => ({
  BUILTIN_NETWORK_TOOLS: [],
  isNetworkTool: () => false,
  executeBuiltinNetworkTool: jest.fn(),
}));
jest.mock("@/lib/agent/email-tools", () => ({
  BUILTIN_EMAIL_TOOLS: [],
  isEmailTool: () => false,
  executeBuiltinEmailTool: jest.fn(),
}));
jest.mock("@/lib/agent/file-tools", () => ({
  BUILTIN_FILE_TOOLS: [],
  isFileTool: () => false,
  executeBuiltinFileTool: jest.fn(),
}));
jest.mock("@/lib/agent/alexa-tools", () => ({
  BUILTIN_ALEXA_TOOLS: [],
  isAlexaTool: () => false,
  executeAlexaTool: jest.fn(),
}));
jest.mock("@/lib/agent/custom-tools", () => ({
  getCustomToolDefinitions: () => [],
  isCustomTool: () => false,
  executeCustomTool: jest.fn(),
}));
jest.mock("@/lib/agent/gatekeeper", () => ({
  executeWithGatekeeper: jest.fn(async () => ({
    status: "executed",
    result: { content: "tool result" },
  })),
}));
jest.mock("@/lib/channels/notify", () => ({
  notifyAdmin: jest.fn(async () => {}),
}));

/* ── Tests ─────────────────────────────────────────────────────────── */

import fs from "fs";

describe("Worker Manager — isWorkerAvailable", () => {
  test("returns true when worker script exists on disk", () => {
    const path = require("path");
    const realFs = jest.requireActual("fs");
    const workerPath = path.join(process.cwd(), "scripts", "agent-worker.js");
    // This test verifies the actual file exists in the repo
    expect(realFs.existsSync(workerPath)).toBe(true);
  });

  test("isWorkerAvailable function is exported", () => {
    jest.isolateModules(() => {
      const wm = require("@/lib/agent/worker-manager");
      expect(typeof wm.isWorkerAvailable).toBe("function");
    });
  });
});

describe("Worker Manager — runLlmInWorker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockWorker.lastInstance = null;
  });

  test("spawns a worker and resolves on 'done' message", async () => {
    const { runLlmInWorker } = require("@/lib/agent/worker-manager");

    const onToken = jest.fn();
    const onStatus = jest.fn();

    const { promise } = runLlmInWorker(
      {
        provider: { providerType: "openai", apiKey: "sk-test", model: "gpt-4" },
        systemPrompt: "You are a test bot.",
        messages: [{ role: "user", content: "Hello" }],
        tools: [],
      },
      onToken,
      onStatus
    );

    // Worker was created
    expect(MockWorker.lastInstance).not.toBeNull();

    // Simulate worker sending tokens
    const messageHandler = mockOn.mock.calls.find(([e]: [string]) => e === "message")?.[1];
    expect(messageHandler).toBeDefined();

    // Send a token
    await messageHandler({ type: "token", data: "Hello" });
    expect(onToken).toHaveBeenCalledWith("Hello");

    // Send status
    await messageHandler({ type: "status", data: { step: "Generating", detail: "Iteration 1" } });
    expect(onStatus).toHaveBeenCalledWith({ step: "Generating", detail: "Iteration 1" });

    // Send done
    await messageHandler({
      type: "done",
      data: { content: "Test response", toolsUsed: [], iterations: 1 },
    });

    const result = await promise;
    expect(result.content).toBe("Test response");
    expect(result.iterations).toBe(1);
  });

  test("handles tool_request by calling onToolRequest callback", async () => {
    const { runLlmInWorker } = require("@/lib/agent/worker-manager");

    const toolResults = [
      { toolCallId: "tc-1", toolName: "web_search", content: '{"results": []}' },
    ];
    const onToolRequest = jest.fn(async () => toolResults);

    const { promise } = runLlmInWorker(
      {
        provider: { providerType: "openai", apiKey: "sk-test", model: "gpt-4" },
        systemPrompt: "Test",
        messages: [{ role: "user", content: "Search" }],
        tools: [{ name: "web_search", description: "Search", inputSchema: {} }],
      },
      undefined,
      undefined,
      onToolRequest
    );

    const messageHandler = mockOn.mock.calls.find(([e]: [string]) => e === "message")?.[1];

    // Worker requests tool execution
    await messageHandler({
      type: "tool_request",
      requestId: "tr_1",
      calls: [{ id: "tc-1", name: "web_search", arguments: { query: "test" } }],
      assistantContent: "Let me search for that",
    });

    expect(onToolRequest).toHaveBeenCalledWith(
      [{ id: "tc-1", name: "web_search", arguments: { query: "test" } }],
      "Let me search for that"
    );

    // Verify tool results were posted back to worker
    expect(mockPostMessage).toHaveBeenCalledWith({
      type: "tool_result",
      requestId: "tr_1",
      results: toolResults,
    });

    // Complete the worker
    await messageHandler({
      type: "done",
      data: { content: "Search complete", toolsUsed: ["web_search"], iterations: 2 },
    });

    const result = await promise;
    expect(result.content).toBe("Search complete");
    expect(result.toolsUsed).toEqual(["web_search"]);
  });

  test("rejects on worker error message", async () => {
    const { runLlmInWorker } = require("@/lib/agent/worker-manager");

    const { promise } = runLlmInWorker(
      {
        provider: { providerType: "openai", apiKey: "sk-test" },
        systemPrompt: "Test",
        messages: [{ role: "user", content: "Hello" }],
        tools: [],
      }
    );

    const messageHandler = mockOn.mock.calls.find(([e]: [string]) => e === "message")?.[1];
    await messageHandler({ type: "error", data: "API key invalid" });

    await expect(promise).rejects.toThrow("API key invalid");
  });

  test("rejects on worker process error", async () => {
    const { runLlmInWorker } = require("@/lib/agent/worker-manager");

    const { promise } = runLlmInWorker(
      {
        provider: { providerType: "openai", apiKey: "sk-test" },
        systemPrompt: "Test",
        messages: [{ role: "user", content: "Hello" }],
        tools: [],
      }
    );

    const errorHandler = mockOn.mock.calls.find(([e]: [string]) => e === "error")?.[1];
    errorHandler(new Error("Worker crashed"));

    await expect(promise).rejects.toThrow("Worker crashed");
  });

  test("abort sends abort message and terminates", async () => {
    const { runLlmInWorker } = require("@/lib/agent/worker-manager");

    const { abort } = runLlmInWorker(
      {
        provider: { providerType: "openai", apiKey: "sk-test" },
        systemPrompt: "Test",
        messages: [{ role: "user", content: "Hello" }],
        tools: [],
      }
    );

    abort();
    expect(mockPostMessage).toHaveBeenCalledWith({ type: "abort" });
  });

  test("sends start config to worker on spawn", () => {
    const { runLlmInWorker } = require("@/lib/agent/worker-manager");

    runLlmInWorker({
      provider: {
        providerType: "anthropic",
        apiKey: "sk-ant-test",
        model: "claude-sonnet-4-20250514",
      },
      systemPrompt: "You are Nexus",
      messages: [{ role: "user", content: "Hi" }],
      tools: [{ name: "web_search", description: "Search", inputSchema: {} }],
      maxIterations: 10,
    });

    // First postMessage should be the start config
    expect(mockPostMessage).toHaveBeenCalledWith({
      type: "start",
      config: expect.objectContaining({
        providerType: "anthropic",
        apiKey: "sk-ant-test",
        model: "claude-sonnet-4-20250514",
        systemPrompt: "You are Nexus",
        maxIterations: 10,
      }),
    });
  });
});

describe("Loop Worker — runAgentLoopWithWorker fallback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("falls back to runAgentLoop for continuation=true", async () => {
    (fs.existsSync as jest.Mock).mockReturnValue(true);

    jest.isolateModules(async () => {
      const loopModule = require("@/lib/agent/loop");
      const runAgentLoopSpy = jest.spyOn(loopModule, "runAgentLoop").mockResolvedValue({
        content: "Continued response",
        toolsUsed: [],
        pendingApprovals: [],
        attachments: [],
      });

      const { runAgentLoopWithWorker } = require("@/lib/agent/loop-worker");
      const result = await runAgentLoopWithWorker(
        "thread-1",
        "",
        undefined,
        undefined,
        true, // continuation
        "user-1"
      );

      expect(runAgentLoopSpy).toHaveBeenCalled();
      expect(result.content).toBe("Continued response");
    });
  });
});

describe("Worker Manager — timeout", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockWorker.lastInstance = null;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("worker times out after 30 seconds, not 300", async () => {
    const { runLlmInWorker } = require("@/lib/agent/worker-manager");

    const { promise } = runLlmInWorker({
      provider: { providerType: "openai", apiKey: "sk-test", model: "gpt-4" },
      systemPrompt: "Test",
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
    });

    // At 29 seconds, the promise should still be pending
    jest.advanceTimersByTime(29_000);
    const racePending = Promise.race([
      promise.then(() => "resolved").catch(() => "rejected"),
      new Promise((r) => setTimeout(() => r("pending"), 0)),
    ]);
    jest.advanceTimersByTime(0);
    expect(await racePending).toBe("pending");

    // At 30 seconds, the worker should be terminated and promise rejected
    jest.advanceTimersByTime(1_000);

    await expect(promise).rejects.toThrow("Agent worker timed out after 30s");
    expect(mockTerminate).toHaveBeenCalled();
  });
});

describe("Worker Script — agent-worker.js", () => {
  test("worker script file exists on disk", () => {
    const path = require("path");
    const realFs = jest.requireActual("fs");
    const workerPath = path.join(process.cwd(), "scripts", "agent-worker.js");
    expect(realFs.existsSync(workerPath)).toBe(true);
  });

  test("worker script is valid JavaScript", () => {
    const path = require("path");
    const realFs = jest.requireActual("fs");
    const workerPath = path.join(process.cwd(), "scripts", "agent-worker.js");
    const code = realFs.readFileSync(workerPath, "utf-8");

    // Should not throw on parse
    expect(() => {
      // Use Function constructor to validate syntax without executing
      new Function(code);
    }).not.toThrow();
  });

  test("worker script requires worker_threads module", () => {
    const path = require("path");
    const realFs = jest.requireActual("fs");
    const workerPath = path.join(process.cwd(), "scripts", "agent-worker.js");
    const code = realFs.readFileSync(workerPath, "utf-8");
    expect(code).toContain("require('worker_threads')");
  });

  test("worker script normalizes litellm baseURL with /v1 suffix", () => {
    const path = require("path");
    const realFs = jest.requireActual("fs");
    const workerPath = path.join(process.cwd(), "scripts", "agent-worker.js");
    const code = realFs.readFileSync(workerPath, "utf-8");
    // The worker must normalize litellm baseURLs by appending /v1
    expect(code).toContain("providerType === 'litellm'");
    expect(code).toContain("'/v1'");
    expect(code).toMatch(/effectiveBaseURL.*\/v1/);
  });
});
