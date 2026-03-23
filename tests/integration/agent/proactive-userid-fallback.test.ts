/**
 * Integration test — proactive userId fallback end-to-end
 *
 * Validates that:
 * - resolveUserId falls back to thread.user_id when an empty string is supplied
 * - resolveUserId returns the explicit userId when one is provided
 * - executeToolWithPolicy dispatches successfully when userId is empty
 */

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { createThread } from "@/lib/db/queries";
import { executeToolWithPolicy, resolveUserId } from "@/lib/agent/tool-executor";
import type { ToolExecutorDeps } from "@/lib/agent/tool-executor-deps";
import { getThread } from "@/lib/db/queries";

// Mock tool registry so dispatch doesn't try to invoke real tools
jest.mock("@/lib/agent/tool-registry", () => ({
  getToolRegistry: () => ({ dispatch: jest.fn().mockResolvedValue({ ok: true }) }),
}));

// Mock normalizeToolName — pass-through
jest.mock("@/lib/agent/discovery", () => ({
  normalizeToolName: (n: string) => n,
}));

let userId: string;
let threadId: string;

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "proactive-fallback@test.com" });
  const thread = createThread("Proactive Fallback Test Thread", userId);
  threadId = thread.id;
});

afterAll(() => teardownTestDb());

function makeDeps(overrides: Partial<ToolExecutorDeps> = {}): ToolExecutorDeps {
  return {
    addLog: jest.fn(),
    getUserById: jest.fn(() => ({ display_name: "Test User", email: "test@test.com" })),
    getToolPolicy: jest.fn(() => ({ requires_approval: 0, tool_name: "test_tool", scope: "global" as const, mcp_id: null })),
    createApprovalRequest: jest.fn(() => ({ id: "approval-fallback-test" })),
    updateThreadStatus: jest.fn(),
    addMessage: jest.fn(),
    getThread: (id: string) => getThread(id),
    findApprovalPreferenceDecision: jest.fn(() => null),
    getChannel: jest.fn(() => undefined),
    notifyAdmin: jest.fn(async () => {}),
    ...overrides,
  };
}

describe("resolveUserId — proactive userId fallback", () => {
  test("resolveUserId('', threadId, getThread) returns thread's user_id", () => {
    const result = resolveUserId("", threadId, (id: string) => getThread(id));
    expect(result).toBe(userId);
    expect(result).not.toBe("");
  });

  test("resolveUserId('explicit-id', threadId, getThread) returns 'explicit-id'", () => {
    const result = resolveUserId("explicit-id", threadId, (id: string) => getThread(id));
    expect(result).toBe("explicit-id");
  });

  test("resolveUserId(undefined, threadId, getThread) returns thread's user_id", () => {
    const result = resolveUserId(undefined, threadId, (id: string) => getThread(id));
    expect(result).toBe(userId);
  });
});

describe("executeToolWithPolicy — userId fallback end-to-end", () => {
  test("executeToolWithPolicy with empty userId executes tool successfully using thread's user_id", async () => {
    const deps = makeDeps();

    const result = await executeToolWithPolicy(
      { id: "tc-fb-1", name: "test_tool", arguments: { key: "value" } },
      threadId,
      "test reasoning for fallback",
      "", // empty string — should fall back to thread.user_id
      deps,
    );

    expect(result.status).toBe("executed");
  });
});
