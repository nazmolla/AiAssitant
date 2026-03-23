/**
 * Unit tests — Agent loop provider fallback exhaustion (closes #252)
 *
 * Validates:
 * - Primary fails → first fallback succeeds → response is returned
 * - Primary + first fallback fail → second fallback succeeds → response returned
 * - All providers fail → throws the last error received
 * - Auth error (401/403) short-circuits the fallback loop immediately
 */

import type { AgentLoopDependencies } from "@/lib/agent/loop";
import type { ChatResponse } from "@/lib/llm";

// ── Minimal DB / infra mocks ───────────────────────────────────

jest.mock("@/lib/logging/logger", () => ({
  newTrace: () => ({
    withCorrelation: () => ({
      enter: jest.fn(),
      exit: jest.fn(),
      error: jest.fn(),
    }),
  }),
  createLogger: () => ({
    enter: jest.fn(),
    exit: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  }),
}));

jest.mock("@/lib/agent/system-prompt", () => ({
  SYSTEM_PROMPT: "",
  MAX_TOOL_ITERATIONS: 5,
  isUntrustedToolOutput: () => false,
}));

jest.mock("@/lib/agent/context-builder", () => ({
  buildKnowledgeContext: jest.fn().mockResolvedValue(""),
  buildProfileContext: jest.fn().mockReturnValue(""),
  buildMcpContext: jest.fn().mockReturnValue(""),
}));

jest.mock("@/lib/agent/message-converter", () => ({
  dbMessagesToChat: jest.fn().mockReturnValue([]),
  compactHistory: jest.fn().mockReturnValue(null),
}));

jest.mock("@/lib/agent/title-generator", () => ({
  maybeUpdateThreadTitle: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/agent/knowledge-persistence", () => ({
  persistKnowledgeFromTurn: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/agent/tool-setup", () => ({
  buildFilteredToolList: jest.fn().mockResolvedValue([]),
}));

jest.mock("@/lib/agent/scheduler-task-persistence", () => ({
  persistScheduledTasksFromMessage: jest.fn(),
}));

jest.mock("@/lib/agent/inline-approval-flow", () => ({
  processInlineApproval: jest.fn().mockResolvedValue({ handled: false }),
}));

jest.mock("@/lib/agent/tool-result-processor", () => ({
  processExecutedToolResult: jest.fn(),
  processFailedToolResult: jest.fn(),
}));

// ── Helpers ────────────────────────────────────────────────────

const OK_RESPONSE: ChatResponse = { content: "Hello!", toolCalls: [], finishReason: "stop" };

/** Build a mock ChatProvider whose chat() either resolves or rejects. */
function makeProvider(result: "ok" | Error) {
  return {
    chat: result === "ok"
      ? jest.fn().mockResolvedValue(OK_RESPONSE)
      : jest.fn().mockRejectedValue(result),
  };
}

/** Build the minimal AgentLoopDependencies for fallback tests. */
function makeDeps(overrides: Partial<AgentLoopDependencies>): AgentLoopDependencies {
  return {
    selectProvider: jest.fn(),
    selectFallbackProvider: jest.fn().mockReturnValue(null),
    buildFilteredToolList: jest.fn().mockResolvedValue([]),
    addMessage: jest.fn().mockReturnValue({ id: "msg-1", thread_id: "t1", role: "user", content: "hi" }),
    getThreadMessages: jest.fn().mockReturnValue([]),
    addAttachment: jest.fn(),
    addLog: jest.fn(),
    executeToolWithPolicy: jest.fn(),
    persistScheduledTasksFromMessage: jest.fn(),
    processInlineApproval: jest.fn().mockResolvedValue({ handled: false }),
    maybeUpdateThreadTitle: jest.fn().mockResolvedValue(undefined),
    persistKnowledgeFromTurn: jest.fn().mockResolvedValue(undefined),
    processExecutedToolResult: jest.fn(),
    processFailedToolResult: jest.fn(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────

// Import AFTER mocks
import { runAgentLoop } from "@/lib/agent/loop";

describe("Agent loop — provider fallback exhaustion (#252)", () => {
  const THREAD_ID = "thread-fallback-test";
  const USER_ID = "user-1";

  test("primary fails → first fallback succeeds → returns response", async () => {
    const primaryProvider = makeProvider(new Error("Rate limit"));
    const fallbackProvider = makeProvider("ok");

    const deps = makeDeps({
      selectProvider: jest.fn().mockReturnValue({
        provider: primaryProvider,
        providerLabel: "Primary",
        taskType: "simple",
        tier: "primary",
        reason: "test",
      }),
      selectFallbackProvider: jest.fn().mockReturnValueOnce({
        provider: fallbackProvider,
        providerLabel: "Fallback",
        taskType: "simple",
        tier: "secondary",
        reason: "fallback",
      }).mockReturnValue(null),
    });

    const result = await runAgentLoop(THREAD_ID, "hello", undefined, undefined, false, USER_ID,
      undefined, undefined, undefined, deps);

    expect(result.content).toBe("Hello!");
    expect(primaryProvider.chat).toHaveBeenCalledTimes(1);
    expect(fallbackProvider.chat).toHaveBeenCalledTimes(1);
  });

  test("primary + first fallback fail → second fallback succeeds → returns response", async () => {
    const primaryProvider = makeProvider(new Error("Provider A down"));
    const fallback1Provider = makeProvider(new Error("Provider B rate limited"));
    const fallback2Provider = makeProvider("ok");

    const deps = makeDeps({
      selectProvider: jest.fn().mockReturnValue({
        provider: primaryProvider,
        providerLabel: "Primary",
        taskType: "simple",
        tier: "primary",
        reason: "test",
      }),
      selectFallbackProvider: jest.fn()
        .mockReturnValueOnce({
          provider: fallback1Provider,
          providerLabel: "Fallback1",
          taskType: "simple",
          tier: "secondary",
          reason: "fallback1",
        })
        .mockReturnValueOnce({
          provider: fallback2Provider,
          providerLabel: "Fallback2",
          taskType: "simple",
          tier: "local",
          reason: "fallback2",
        })
        .mockReturnValue(null),
    });

    const result = await runAgentLoop(THREAD_ID, "hello", undefined, undefined, false, USER_ID,
      undefined, undefined, undefined, deps);

    expect(result.content).toBe("Hello!");
    expect(primaryProvider.chat).toHaveBeenCalledTimes(1);
    expect(fallback1Provider.chat).toHaveBeenCalledTimes(1);
    expect(fallback2Provider.chat).toHaveBeenCalledTimes(1);
  });

  test("all providers fail → throws the last error", async () => {
    const firstErr = new Error("Primary failed");
    const lastErr = new Error("Fallback also failed");
    const primaryProvider = makeProvider(firstErr);
    const fallbackProvider = makeProvider(lastErr);

    const deps = makeDeps({
      selectProvider: jest.fn().mockReturnValue({
        provider: primaryProvider,
        providerLabel: "Primary",
        taskType: "simple",
        tier: "primary",
        reason: "test",
      }),
      selectFallbackProvider: jest.fn()
        .mockReturnValueOnce({
          provider: fallbackProvider,
          providerLabel: "Fallback",
          taskType: "simple",
          tier: "secondary",
          reason: "fallback",
        })
        .mockReturnValue(null),
    });

    await expect(
      runAgentLoop(THREAD_ID, "hello", undefined, undefined, false, USER_ID,
        undefined, undefined, undefined, deps)
    ).rejects.toThrow("Fallback also failed");
  });

  test("auth error from primary → throws immediately without trying fallback", async () => {
    const authErr = Object.assign(new Error("Unauthorized"), { status: 401 });
    const primaryProvider = makeProvider(authErr);
    const fallbackProvider = makeProvider("ok");
    const selectFallbackProvider = jest.fn().mockReturnValue({
      provider: fallbackProvider,
      providerLabel: "Fallback",
      taskType: "simple",
      tier: "secondary",
      reason: "fallback",
    });

    const deps = makeDeps({
      selectProvider: jest.fn().mockReturnValue({
        provider: primaryProvider,
        providerLabel: "Primary",
        taskType: "simple",
        tier: "primary",
        reason: "test",
      }),
      selectFallbackProvider,
    });

    await expect(
      runAgentLoop(THREAD_ID, "hello", undefined, undefined, false, USER_ID,
        undefined, undefined, undefined, deps)
    ).rejects.toThrow("Unauthorized");

    // selectFallbackProvider should never have been called
    expect(selectFallbackProvider).not.toHaveBeenCalled();
    expect(fallbackProvider.chat).not.toHaveBeenCalled();
  });

  test("auth error from fallback → throws immediately without trying next fallback", async () => {
    const primaryErr = new Error("Rate limit");
    const authErr = Object.assign(new Error("Forbidden"), { status: 403 });
    const primaryProvider = makeProvider(primaryErr);
    const fallbackProvider = makeProvider(authErr);
    const fallback2Provider = makeProvider("ok");

    const selectFallbackProvider = jest.fn()
      .mockReturnValueOnce({
        provider: fallbackProvider,
        providerLabel: "Fallback",
        taskType: "simple",
        tier: "secondary",
        reason: "fallback",
      })
      .mockReturnValueOnce({
        provider: fallback2Provider,
        providerLabel: "Fallback2",
        taskType: "simple",
        tier: "local",
        reason: "fallback2",
      });

    const deps = makeDeps({
      selectProvider: jest.fn().mockReturnValue({
        provider: primaryProvider,
        providerLabel: "Primary",
        taskType: "simple",
        tier: "primary",
        reason: "test",
      }),
      selectFallbackProvider,
    });

    await expect(
      runAgentLoop(THREAD_ID, "hello", undefined, undefined, false, USER_ID,
        undefined, undefined, undefined, deps)
    ).rejects.toThrow("Forbidden");

    // Only first fallback was tried; second fallback never reached
    expect(fallback2Provider.chat).not.toHaveBeenCalled();
  });
});
