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

// Mock worker_threads — per-instance mocks for pool support
class MockWorker {
  static instances: MockWorker[] = [];

  postMessage = jest.fn();
  terminate = jest.fn();
  private handlers: Record<string, Function> = {};

  constructor(_scriptPath: string) {
    MockWorker.instances.push(this);
  }

  on(event: string, handler: Function) {
    this.handlers[event] = handler;
  }

  async triggerMessage(msg: unknown) {
    const handler = this.handlers["message"];
    if (handler) await handler(msg);
  }

  triggerError(err: Error) {
    const handler = this.handlers["error"];
    if (handler) handler(err);
  }

  triggerExit(code: number) {
    const handler = this.handlers["exit"];
    if (handler) handler(code);
  }

  static reset() {
    MockWorker.instances = [];
  }

  /** Find the pool worker that received the given task (by checking postMessage calls for "start") */
  static findTaskWorker(): MockWorker | undefined {
    return MockWorker.instances.find((w) =>
      w.postMessage.mock.calls.some((c: unknown[]) => (c[0] as { type: string })?.type === "start")
    );
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
jest.mock("@/lib/tools/web-tools", () => ({
  BUILTIN_WEB_TOOLS: [],
  isBuiltinWebTool: () => false,
  executeBuiltinWebTool: jest.fn(),
  WEB_TOOLS_REQUIRING_APPROVAL: [],
}));
jest.mock("@/lib/tools/browser-tools", () => ({
  BUILTIN_BROWSER_TOOLS: [],
  isBrowserTool: () => false,
  executeBrowserTool: jest.fn(),
  BROWSER_TOOLS_REQUIRING_APPROVAL: [],
}));
jest.mock("@/lib/tools/fs-tools", () => ({
  BUILTIN_FS_TOOLS: [],
  isFsTool: () => false,
  executeBuiltinFsTool: jest.fn(),
  FS_TOOLS_REQUIRING_APPROVAL: [],
}));
jest.mock("@/lib/tools/network-tools", () => ({
  BUILTIN_NETWORK_TOOLS: [],
  isNetworkTool: () => false,
  executeBuiltinNetworkTool: jest.fn(),
  NETWORK_TOOLS_REQUIRING_APPROVAL: [],
}));
jest.mock("@/lib/tools/email-tools", () => ({
  BUILTIN_EMAIL_TOOLS: [],
  isEmailTool: () => false,
  executeBuiltinEmailTool: jest.fn(),
  EMAIL_TOOLS_REQUIRING_APPROVAL: [],
}));
jest.mock("@/lib/tools/file-tools", () => ({
  BUILTIN_FILE_TOOLS: [],
  isFileTool: () => false,
  executeBuiltinFileTool: jest.fn(),
  FILE_TOOLS_REQUIRING_APPROVAL: [],
}));
jest.mock("@/lib/tools/alexa-tools", () => ({
  BUILTIN_ALEXA_TOOLS: [],
  isAlexaTool: () => false,
  executeAlexaTool: jest.fn(),
  ALEXA_TOOLS_REQUIRING_APPROVAL: [],
}));
jest.mock("@/lib/tools/custom-tools", () => ({
  getCustomToolDefinitions: () => [],
  isCustomTool: () => false,
  executeCustomTool: jest.fn(),
  CUSTOM_TOOLS_REQUIRING_APPROVAL: [],
  BUILTIN_TOOLMAKER_TOOLS: [],
}));
jest.mock("@/lib/agent/gatekeeper", () => ({
  executeWithGatekeeper: jest.fn(async () => ({
    status: "executed",
    result: { content: "tool result" },
  })),
}));
jest.mock("@/lib/notifications", () => ({
  notifyAdmin: jest.fn(async () => {}),
  notify: jest.fn(async () => {}),
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
    MockWorker.reset();
    const wm = require("@/lib/agent/worker-manager");
    wm._resetPool();
  });

  test("dispatches task to a pool worker and resolves on 'done'", async () => {
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

    // Pool creates workers, find the one with the task
    const taskWorker = MockWorker.findTaskWorker();
    expect(taskWorker).toBeDefined();

    // Send a token
    await taskWorker!.triggerMessage({ type: "token", data: "Hello" });
    expect(onToken).toHaveBeenCalledWith("Hello");

    // Send status
    await taskWorker!.triggerMessage({ type: "status", data: { step: "Generating", detail: "Iteration 1" } });
    expect(onStatus).toHaveBeenCalledWith({ step: "Generating", detail: "Iteration 1" });

    // Send done
    await taskWorker!.triggerMessage({
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

    const taskWorker = MockWorker.findTaskWorker()!;

    // Worker requests tool execution
    await taskWorker.triggerMessage({
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
    expect(taskWorker.postMessage).toHaveBeenCalledWith({
      type: "tool_result",
      requestId: "tr_1",
      results: toolResults,
    });

    // Complete the worker
    await taskWorker.triggerMessage({
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

    const taskWorker = MockWorker.findTaskWorker()!;
    await taskWorker.triggerMessage({ type: "error", data: "API key invalid" });

    await expect(promise).rejects.toThrow("API key invalid");
  });

  test("rejects on worker process error and replaces worker", async () => {
    const { runLlmInWorker } = require("@/lib/agent/worker-manager");

    const { promise } = runLlmInWorker(
      {
        provider: { providerType: "openai", apiKey: "sk-test" },
        systemPrompt: "Test",
        messages: [{ role: "user", content: "Hello" }],
        tools: [],
      }
    );

    const taskWorker = MockWorker.findTaskWorker()!;
    const instanceCountBefore = MockWorker.instances.length;
    taskWorker.triggerError(new Error("Worker crashed"));

    await expect(promise).rejects.toThrow("Worker crashed");
    // A replacement worker was spawned
    expect(MockWorker.instances.length).toBe(instanceCountBefore + 1);
  });

  test("abort sends abort message to the dispatched worker", async () => {
    const { runLlmInWorker } = require("@/lib/agent/worker-manager");

    const { promise, abort } = runLlmInWorker(
      {
        provider: { providerType: "openai", apiKey: "sk-test" },
        systemPrompt: "Test",
        messages: [{ role: "user", content: "Hello" }],
        tools: [],
      }
    );
    promise.catch(() => {}); // suppress expected rejection

    const taskWorker = MockWorker.findTaskWorker()!;
    abort();
    expect(taskWorker.postMessage).toHaveBeenCalledWith({ type: "abort" });
  });

  test("sends start config to the pool worker", () => {
    const { runLlmInWorker } = require("@/lib/agent/worker-manager");

    const { promise } = runLlmInWorker({
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
    promise.catch(() => {}); // suppress timeout rejection

    const taskWorker = MockWorker.findTaskWorker()!;
    expect(taskWorker.postMessage).toHaveBeenCalledWith({
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
    MockWorker.reset();
    const wm = require("@/lib/agent/worker-manager");
    wm._resetPool();
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
    const taskWorker = MockWorker.findTaskWorker()!;
    expect(taskWorker.terminate).toHaveBeenCalled();
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

  test("worker script resets state between tasks for pool reuse", () => {
    const path = require("path");
    const realFs = jest.requireActual("fs");
    const workerPath = path.join(process.cwd(), "scripts", "agent-worker.js");
    const code = realFs.readFileSync(workerPath, "utf-8");
    // Must reset aborted flag and clear pending resolvers
    expect(code).toContain("aborted = false");
    expect(code).toContain("toolResultResolvers.clear()");
  });
});

/* ── Worker Pool ───────────────────────────────────────────────────── */

describe("Worker Pool — pool behavior", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockWorker.reset();
    const wm = require("@/lib/agent/worker-manager");
    wm._resetPool();
  });

  test("pool creates default number of workers on first runLlmInWorker call", () => {
    const { runLlmInWorker } = require("@/lib/agent/worker-manager");

    runLlmInWorker({
      provider: { providerType: "openai", apiKey: "sk-test" },
      systemPrompt: "Test",
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
    });

    // Default pool size is 2
    expect(MockWorker.instances.length).toBeGreaterThanOrEqual(2);
  });

  test("reuses workers for sequential tasks (no new workers spawned)", async () => {
    const { runLlmInWorker } = require("@/lib/agent/worker-manager");

    // Task 1
    const { promise: p1 } = runLlmInWorker({
      provider: { providerType: "openai", apiKey: "sk-test" },
      systemPrompt: "Test",
      messages: [{ role: "user", content: "Task 1" }],
      tools: [],
    });

    const countAfterFirst = MockWorker.instances.length;
    const taskWorker1 = MockWorker.findTaskWorker()!;

    // Complete task 1
    await taskWorker1.triggerMessage({
      type: "done",
      data: { content: "Done 1", toolsUsed: [], iterations: 1 },
    });
    await p1;

    // Task 2 — should reuse existing pool worker, no new spawn
    const { promise: p2 } = runLlmInWorker({
      provider: { providerType: "openai", apiKey: "sk-test" },
      systemPrompt: "Test",
      messages: [{ role: "user", content: "Task 2" }],
      tools: [],
    });

    expect(MockWorker.instances.length).toBe(countAfterFirst);

    // Complete task 2
    const taskWorker2 = MockWorker.instances.find(
      (w) => w.postMessage.mock.calls.filter(
        (c: unknown[]) => (c[0] as { type: string })?.type === "start"
      ).length > 0 && !w.terminate.mock.calls.length
    )!;
    await taskWorker2.triggerMessage({
      type: "done",
      data: { content: "Done 2", toolsUsed: [], iterations: 1 },
    });
    await p2;
  });

  test("replaces crashed workers with new ones", async () => {
    const { runLlmInWorker } = require("@/lib/agent/worker-manager");

    const { promise } = runLlmInWorker({
      provider: { providerType: "openai", apiKey: "sk-test" },
      systemPrompt: "Test",
      messages: [{ role: "user", content: "Hello" }],
      tools: [],
    });

    const countBeforeCrash = MockWorker.instances.length;
    const taskWorker = MockWorker.findTaskWorker()!;

    // Simulate crash
    taskWorker.triggerError(new Error("Segfault"));

    await expect(promise).rejects.toThrow("Segfault");
    // A replacement was spawned
    expect(MockWorker.instances.length).toBe(countBeforeCrash + 1);
    // Original was terminated
    expect(taskWorker.terminate).toHaveBeenCalled();
  });

  test("getWorkerPoolStats returns correct info", async () => {
    const { runLlmInWorker, getWorkerPoolStats } = require("@/lib/agent/worker-manager");

    // Before any call — pool not initialized
    const statsBefore = getWorkerPoolStats();
    expect(statsBefore.initialized).toBe(false);

    // Start a task to trigger pool init
    const { promise } = runLlmInWorker({
      provider: { providerType: "openai", apiKey: "sk-test" },
      systemPrompt: "Test",
      messages: [{ role: "user", content: "Hi" }],
      tools: [],
    });

    const statsActive = getWorkerPoolStats();
    expect(statsActive.initialized).toBe(true);
    expect(statsActive.busyCount).toBe(1);
    expect(statsActive.idleCount).toBeGreaterThanOrEqual(1);

    // Complete the task
    const taskWorker = MockWorker.findTaskWorker()!;
    await taskWorker.triggerMessage({
      type: "done",
      data: { content: "Done", toolsUsed: [], iterations: 1 },
    });
    await promise;

    const statsAfter = getWorkerPoolStats();
    expect(statsAfter.busyCount).toBe(0);
  });
});

describe("Worker Pool — source verification", () => {
  const readSource = () => {
    const realFs = jest.requireActual("fs");
    const path = require("path");
    return realFs.readFileSync(
      path.join(process.cwd(), "src", "lib", "agent", "worker-manager.ts"),
      "utf-8"
    ) as string;
  };

  test("uses WORKER_POOL_SIZE env var for configuration", () => {
    const code = readSource();
    expect(code).toContain("WORKER_POOL_SIZE");
    expect(code).toContain("env.WORKER_POOL_SIZE");
  });

  test("has drainQueue for task queuing when all workers busy", () => {
    const code = readSource();
    expect(code).toContain("drainQueue");
    expect(code).toContain("taskQueue");
  });

  test("has replaceWorker for crash recovery", () => {
    const code = readSource();
    expect(code).toContain("replaceWorker");
    expect(code).toContain("Worker crashed and was replaced");
  });

  test("exports getWorkerPoolStats for monitoring", () => {
    const code = readSource();
    expect(code).toContain("export function getWorkerPoolStats");
  });
});
