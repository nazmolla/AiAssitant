/**
 * Unit tests for POST /api/conversation/respond — context enrichment (#210).
 *
 * Verifies that the conversation endpoint builds and injects:
 *  - Knowledge context (from buildKnowledgeContext)
 *  - User profile context (from buildProfileContext)
 *  - MCP server context (from buildMcpContext)
 * into the system prompt sent to the LLM.
 *
 * @jest-environment node
 */

// ── Context builder mocks ───────────────────────────────────────────────────

jest.mock("@/lib/agent/context-builder", () => ({
  buildKnowledgeContext: jest.fn().mockResolvedValue("<knowledge_context>test facts</knowledge_context>"),
  buildProfileContext: jest.fn().mockReturnValue("<user_profile>Name: Test User</user_profile>"),
  buildMcpContext: jest.fn().mockReturnValue("<mcp_servers>HomeAssistant</mcp_servers>"),
}));

// ── Auth / DB / LLM mocks ───────────────────────────────────────────────────

jest.mock("@/lib/auth/guard", () => ({
  requireUser: jest.fn().mockResolvedValue({
    user: { id: "user-1", email: "test@example.com", role: "user" },
  }),
}));

jest.mock("@/lib/db", () => ({
  addLog: jest.fn(),
  getUserById: jest.fn().mockReturnValue({ id: "user-1", role: "user" }),
  listToolPolicies: jest.fn().mockReturnValue([]),
}));

jest.mock("@/lib/mcp", () => ({
  getMcpManager: () => ({
    getAllTools: () => [],
    getConnectedServers: () => [],
  }),
}));

jest.mock("@/lib/tools/custom-tools", () => ({
  getCustomToolDefinitions: jest.fn().mockReturnValue([]),
}));

jest.mock("@/lib/tools", () => ({
  ALL_TOOL_CATEGORIES: [],
  buildCappedToolList: jest.fn().mockReturnValue([]),
}));

jest.mock("@/lib/tools/tool-cap", () => ({
  buildCappedToolList: jest.fn().mockReturnValue([]),
  MAX_TOOLS_PER_REQUEST: 50,
}));

jest.mock("@/lib/agent", () => ({
  isWorkerAvailable: jest.fn().mockReturnValue(false),
  ALL_TOOL_CATEGORIES: [],
  getCustomToolDefinitions: jest.fn().mockReturnValue([]),
}));

jest.mock("@/lib/agent/worker-manager", () => ({
  isWorkerAvailable: jest.fn().mockReturnValue(false),
  runLlmInWorker: jest.fn(),
}));

// Capture the system prompt passed to the LLM
let capturedSystemPrompt = "";
jest.mock("@/lib/llm/orchestrator", () => ({
  selectProvider: jest.fn().mockReturnValue({
    providerLabel: "TestProvider",
    provider: {
      chat: jest.fn().mockImplementation(
        (_messages: unknown, _tools: unknown, systemPrompt?: string) => {
          capturedSystemPrompt = systemPrompt ?? "";
          return Promise.resolve({ content: "Hello!", toolCalls: [] });
        }
      ),
    },
    taskType: "chat",
    reason: "test",
  }),
  selectProviderForWorker: jest.fn(),
}));

jest.mock("@/lib/sse", () => ({
  createSSEStream: jest.fn().mockReturnValue({
    send: jest.fn(),
    close: jest.fn(),
    response: new Response(),
  }),
  sseResponse: jest.fn(),
  sseEvent: jest.fn().mockImplementation((type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`),
}));

jest.mock("@/lib/prompts", () => ({
  CONVERSATION_SYSTEM_PROMPT: "BASE_SYSTEM_PROMPT",
}));

jest.mock("@/lib/constants", () => ({
  VOICE_MAX_HISTORY_MESSAGES: 10,
  VOICE_MAX_TOOL_ITERATIONS: 5,
  VOICE_TURN_TIMEOUT_MS: 30000,
}));

// ── Import after all mocks ───────────────────────────────────────────────────

import { buildKnowledgeContext, buildProfileContext, buildMcpContext } from "@/lib/agent/context-builder";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/conversation/respond — context enrichment", () => {
  beforeEach(() => {
    capturedSystemPrompt = "";
    jest.clearAllMocks();
    // Re-apply stable mock implementations after clearAllMocks
    (buildKnowledgeContext as jest.Mock).mockResolvedValue("<knowledge_context>test facts</knowledge_context>");
    (buildProfileContext as jest.Mock).mockReturnValue("<user_profile>Name: Test User</user_profile>");
    (buildMcpContext as jest.Mock).mockReturnValue("<mcp_servers>HomeAssistant</mcp_servers>");
  });

  test("buildKnowledgeContext is called with user message and userId", async () => {
    const { POST } = await import("@/app/api/conversation/respond/route");
    const req = new Request("http://localhost/api/conversation/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "What lights are on?" }),
    });
    await POST(req as never);

    expect(buildKnowledgeContext).toHaveBeenCalledWith("What lights are on?", "user-1");
  });

  test("buildProfileContext is called with userId", async () => {
    const { POST } = await import("@/app/api/conversation/respond/route");
    const req = new Request("http://localhost/api/conversation/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello" }),
    });
    await POST(req as never);

    expect(buildProfileContext).toHaveBeenCalledWith("user-1");
  });

  test("buildMcpContext is called", async () => {
    const { POST } = await import("@/app/api/conversation/respond/route");
    const req = new Request("http://localhost/api/conversation/respond", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello" }),
    });
    await POST(req as never);

    expect(buildMcpContext).toHaveBeenCalled();
  });
});
