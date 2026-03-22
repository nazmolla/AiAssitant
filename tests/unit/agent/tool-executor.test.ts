/**
 * Unit tests — executeToolWithPolicy (unified tool executor)
 *
 * Validates:
 * - Policy allows (requires_approval=0) → executes via registry
 * - No policy (default-deny) → pending_approval
 * - Policy requires approval (requires_approval=1), proactive source → pending_approval
 * - Policy requires approval, chat source → pending_approval (inline)
 * - Auto-approved by preference → executes
 * - Auto-rejected by preference → error
 * - Auto-ignored by preference → executed with ignored result
 * - Missing reason for approval → error
 * - Registry dispatch failure → error
 * - Empty string userId falls back to thread user_id
 */
import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { upsertToolPolicy, createThread, getToolPolicy } from "@/lib/db/queries";
import { executeToolWithPolicy } from "@/lib/agent/tool-executor";
import type { ToolExecutorDeps } from "@/lib/agent/tool-executor-deps";

// Mock tool registry so we can control dispatch results
const mockDispatch = jest.fn(async (_name: string, _args: unknown) => ({ ok: true }));
jest.mock("@/lib/agent/tool-registry", () => ({
  getToolRegistry: () => ({ dispatch: mockDispatch }),
}));

// Mock normalizeToolName — pass-through so tool names stay as-is in tests
jest.mock("@/lib/agent/discovery", () => ({
  normalizeToolName: (name: string) => name,
}));

let userId: string;
let threadId: string;

// Build a minimal deps object with all required stubs
function makeDeps(overrides: Partial<ToolExecutorDeps> = {}): ToolExecutorDeps {
  return {
    addLog: jest.fn(),
    getUserById: jest.fn(() => ({ display_name: "Test User", email: "test@test.com" })),
    getToolPolicy: jest.fn(() => undefined),
    createApprovalRequest: jest.fn(() => ({ id: "approval-123" })),
    updateThreadStatus: jest.fn(),
    addMessage: jest.fn(),
    getThread: jest.fn(() => ({
      id: threadId,
      user_id: userId,
      thread_type: "proactive",
      channel_id: null,
      external_sender_id: null,
    })),
    findApprovalPreferenceDecision: jest.fn(() => null),
    getChannel: jest.fn(() => undefined),
    notifyAdmin: jest.fn(async () => {}),
    ...overrides,
  };
}

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "tool-executor@test.com" });
  const thread = createThread("Tool Executor Test", userId);
  threadId = thread.id;
});
afterAll(() => teardownTestDb());

describe("executeToolWithPolicy — policy-based auto-execution", () => {
  test("requires_approval=0 — executes directly", async () => {
    const deps = makeDeps({
      getToolPolicy: jest.fn(() => ({ requires_approval: 0, tool_name: "safe_tool", scope: null })),
    });

    const result = await executeToolWithPolicy(
      { id: "tc-1", name: "safe_tool", arguments: {} },
      threadId,
      "testing",
      userId,
      deps
    );

    expect(result.status).toBe("executed");
    expect(result.result).toEqual({ ok: true });
  });

  test("no policy (default-deny) with reason — creates approval request", async () => {
    const deps = makeDeps({
      getToolPolicy: jest.fn(() => undefined),
    });

    const result = await executeToolWithPolicy(
      { id: "tc-2", name: "unknown_tool", arguments: {} },
      threadId,
      "I need to run this tool",
      userId,
      deps
    );

    expect(result.status).toBe("pending_approval");
    expect(result.approvalId).toBeDefined();
    expect(deps.createApprovalRequest).toHaveBeenCalled();
  });

  test("requires_approval=1 with reason — creates approval request", async () => {
    const deps = makeDeps({
      getToolPolicy: jest.fn(() => ({ requires_approval: 1, tool_name: "dangerous_tool", scope: null })),
    });

    const result = await executeToolWithPolicy(
      { id: "tc-3", name: "dangerous_tool", arguments: {} },
      threadId,
      "Needs approval for this action",
      userId,
      deps
    );

    expect(result.status).toBe("pending_approval");
    expect(result.approvalId).toBeDefined();
  });

  test("requires_approval=1 with no reason — returns error", async () => {
    const deps = makeDeps({
      getToolPolicy: jest.fn(() => ({ requires_approval: 1, tool_name: "dangerous_tool_no_reason", scope: null })),
      findApprovalPreferenceDecision: jest.fn(() => null),
    });

    const result = await executeToolWithPolicy(
      { id: "tc-4", name: "dangerous_tool_no_reason", arguments: {} },
      threadId,
      undefined, // no reasoning
      userId,
      deps
    );

    expect(result.status).toBe("error");
    expect(result.error).toContain("requires a clear reason");
  });

  test("chat source — returns inline pending_approval", async () => {
    const deps = makeDeps({
      getToolPolicy: jest.fn(() => ({ requires_approval: 1, tool_name: "chat_tool", scope: null })),
      getThread: jest.fn(() => ({
        id: threadId,
        user_id: userId,
        thread_type: "interactive",
        channel_id: null,
        external_sender_id: null,
      })),
    });

    const result = await executeToolWithPolicy(
      { id: "tc-5", name: "chat_tool", arguments: {} },
      threadId,
      "User requested this action",
      userId,
      deps
    );

    expect(result.status).toBe("pending_approval");
    expect(result.approvalId).toMatch(/^inline-/);
    expect(deps.updateThreadStatus).toHaveBeenCalledWith(threadId, "awaiting_user_confirmation");
    expect(deps.addMessage).toHaveBeenCalled();
  });
});

describe("executeToolWithPolicy — preference decisions", () => {
  test("auto-approved by preference — executes", async () => {
    const deps = makeDeps({
      getToolPolicy: jest.fn(() => ({ requires_approval: 1, tool_name: "pref_tool", scope: null })),
      findApprovalPreferenceDecision: jest.fn(() => "approved"),
    });

    const result = await executeToolWithPolicy(
      { id: "tc-6", name: "pref_tool", arguments: {} },
      threadId,
      "testing preference",
      userId,
      deps
    );

    expect(result.status).toBe("executed");
  });

  test("auto-rejected by preference — returns error", async () => {
    const deps = makeDeps({
      getToolPolicy: jest.fn(() => ({ requires_approval: 1, tool_name: "rejected_tool", scope: null })),
      findApprovalPreferenceDecision: jest.fn(() => "rejected"),
    });

    const result = await executeToolWithPolicy(
      { id: "tc-7", name: "rejected_tool", arguments: {} },
      threadId,
      "testing preference",
      userId,
      deps
    );

    expect(result.status).toBe("error");
    expect(result.error).toContain("Auto-rejected by preference");
  });

  test("auto-ignored by preference — executed with ignored result", async () => {
    const deps = makeDeps({
      getToolPolicy: jest.fn(() => ({ requires_approval: 1, tool_name: "ignored_tool", scope: null })),
      findApprovalPreferenceDecision: jest.fn(() => "ignored"),
    });

    const result = await executeToolWithPolicy(
      { id: "tc-8", name: "ignored_tool", arguments: {} },
      threadId,
      "testing preference",
      userId,
      deps
    );

    expect(result.status).toBe("executed");
    expect((result.result as { status: string }).status).toBe("ignored");
  });
});

describe("executeToolWithPolicy — error handling", () => {
  test("registry dispatch failure — returns error status", async () => {
    mockDispatch.mockRejectedValueOnce(new Error("tool crashed"));

    const deps = makeDeps({
      getToolPolicy: jest.fn(() => ({ requires_approval: 0, tool_name: "crashing_tool", scope: null })),
    });

    const result = await executeToolWithPolicy(
      { id: "tc-9", name: "crashing_tool", arguments: {} },
      threadId,
      "testing",
      userId,
      deps
    );

    expect(result.status).toBe("error");
    expect(result.error).toBe("tool crashed");
  });

  test("empty string userId falls back to thread user_id", async () => {
    const deps = makeDeps({
      getToolPolicy: jest.fn(() => ({ requires_approval: 0, tool_name: "fallback_user_tool", scope: null })),
    });

    const result = await executeToolWithPolicy(
      { id: "tc-10", name: "fallback_user_tool", arguments: {} },
      threadId,
      "testing",
      "", // empty string — should fall back to thread.user_id
      deps
    );

    expect(result.status).toBe("executed");
  });
});
