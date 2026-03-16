/**
 * Unit tests — PromptTool abstraction
 *
 * Tests:
 * - Construction and tool definition generation
 * - matches() method (exact-match only)
 * - execute() delegates to runAgentLoop with correct arguments
 * - Error handling for missing threadId / userId
 * - additionalContext appended to system prompt
 *
 * @see https://github.com/nazmolla/AiAssitant/issues/145
 */

jest.mock("@/lib/agent", () => ({
  runAgentLoop: jest.fn(async () => ({
    content: "Mock response",
    toolsUsed: ["builtin.web_search"],
    pendingApprovals: [],
  })),
}));

import { PromptTool, type PromptToolConfig } from "@/lib/tools/prompt-tool";
import { BaseTool } from "@/lib/tools/base-tool";
import { runAgentLoop } from "@/lib/agent";

const TEST_CONFIG: PromptToolConfig = {
  toolName: "builtin.workflow_test_step",
  displayName: "Test Step",
  description: "A test prompt tool for unit tests.",
  systemPrompt: "You are a test assistant. Follow the instructions carefully.",
};

let tool: PromptTool;

beforeEach(() => {
  jest.clearAllMocks();
  tool = new PromptTool(TEST_CONFIG);
});

/* ══════════════════════════════════════════════════════════════════
   Construction
   ══════════════════════════════════════════════════════════════════ */

describe("PromptTool construction", () => {
  test("extends BaseTool", () => {
    expect(tool).toBeInstanceOf(BaseTool);
  });

  test("sets name to displayName", () => {
    expect(tool.name).toBe("Test Step");
  });

  test("sets toolNamePrefix to toolName", () => {
    expect(tool.toolNamePrefix).toBe("builtin.workflow_test_step");
  });

  test("generates exactly one tool definition", () => {
    expect(tool.tools).toHaveLength(1);
  });

  test("tool definition has correct name and description", () => {
    const def = tool.tools[0];
    expect(def.name).toBe("builtin.workflow_test_step");
    expect(def.description).toBe("A test prompt tool for unit tests.");
  });

  test("tool definition has default input schema with threadId/userId required", () => {
    const schema = tool.tools[0].inputSchema as Record<string, unknown>;
    expect(schema).toBeDefined();
    const props = schema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("threadId");
    expect(props).toHaveProperty("userId");
    expect(props).toHaveProperty("additionalContext");
    expect(schema.required).toEqual(["threadId", "userId"]);
  });

  test("custom inputSchema overrides default", () => {
    const custom = new PromptTool({
      ...TEST_CONFIG,
      inputSchema: { type: "object", properties: { foo: { type: "string" } } },
    });
    const schema = custom.tools[0].inputSchema as Record<string, unknown>;
    const props = schema.properties as Record<string, unknown>;
    expect(props).toHaveProperty("foo");
    expect(props).not.toHaveProperty("threadId");
  });

  test("toolsRequiringApproval is empty", () => {
    expect(tool.toolsRequiringApproval).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════
   matches()
   ══════════════════════════════════════════════════════════════════ */

describe("PromptTool.matches()", () => {
  test("returns true for exact tool name", () => {
    expect(tool.matches("builtin.workflow_test_step")).toBe(true);
  });

  test("returns false for partial prefix match", () => {
    expect(tool.matches("builtin.workflow_test")).toBe(false);
  });

  test("returns false for completely different name", () => {
    expect(tool.matches("builtin.web_search")).toBe(false);
  });

  test("returns false for name that contains the tool name as substring", () => {
    expect(tool.matches("builtin.workflow_test_step_extra")).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════
   execute()
   ══════════════════════════════════════════════════════════════════ */

describe("PromptTool.execute()", () => {
  const ctx = { threadId: "thread-1", userId: "user-1" };

  test("calls runAgentLoop with correct threadId and prompt", async () => {
    await tool.execute("builtin.workflow_test_step", {
      threadId: "thread-1",
      userId: "user-1",
    }, ctx);

    expect(runAgentLoop).toHaveBeenCalledTimes(1);
    const [tid, prompt] = (runAgentLoop as jest.Mock).mock.calls[0];
    expect(tid).toBe("thread-1");
    expect(prompt).toBe(TEST_CONFIG.systemPrompt);
  });

  test("passes userId as 6th argument to runAgentLoop", async () => {
    await tool.execute("builtin.workflow_test_step", {
      threadId: "thread-1",
      userId: "user-42",
    }, ctx);

    const args = (runAgentLoop as jest.Mock).mock.calls[0];
    expect(args[5]).toBe("user-42");
  });

  test("appends additionalContext to prompt when provided", async () => {
    await tool.execute("builtin.workflow_test_step", {
      threadId: "thread-1",
      userId: "user-1",
      additionalContext: "Focus on remote positions only.",
    }, ctx);

    const [, prompt] = (runAgentLoop as jest.Mock).mock.calls[0];
    expect(prompt).toContain(TEST_CONFIG.systemPrompt);
    expect(prompt).toContain("Focus on remote positions only.");
  });

  test("uses only systemPrompt when additionalContext is empty", async () => {
    await tool.execute("builtin.workflow_test_step", {
      threadId: "thread-1",
      userId: "user-1",
      additionalContext: "",
    }, ctx);

    const [, prompt] = (runAgentLoop as jest.Mock).mock.calls[0];
    expect(prompt).toBe(TEST_CONFIG.systemPrompt);
  });

  test("returns response and toolsUsed from agent loop", async () => {
    const result = await tool.execute("builtin.workflow_test_step", {
      threadId: "thread-1",
      userId: "user-1",
    }, ctx) as { response: string; toolsUsed: string[] };

    expect(result.response).toBe("Mock response");
    expect(result.toolsUsed).toEqual(["builtin.web_search"]);
  });

  test("falls back to context threadId when args.threadId is empty", async () => {
    await tool.execute("builtin.workflow_test_step", {
      threadId: "",
      userId: "user-1",
    }, { threadId: "ctx-thread", userId: "user-1" });

    const [tid] = (runAgentLoop as jest.Mock).mock.calls[0];
    expect(tid).toBe("ctx-thread");
  });

  test("falls back to context userId when args.userId is empty", async () => {
    await tool.execute("builtin.workflow_test_step", {
      threadId: "thread-1",
      userId: "",
    }, { threadId: "thread-1", userId: "ctx-user" });

    const args = (runAgentLoop as jest.Mock).mock.calls[0];
    expect(args[5]).toBe("ctx-user");
  });

  test("throws when no threadId available from args or context", async () => {
    await expect(
      tool.execute("builtin.workflow_test_step", {}, { threadId: "", userId: "u" }),
    ).rejects.toThrow("requires a threadId");
  });

  test("throws when no userId available from args or context", async () => {
    await expect(
      tool.execute("builtin.workflow_test_step", { threadId: "t" }, { threadId: "t" }),
    ).rejects.toThrow("requires a userId");
  });
});
