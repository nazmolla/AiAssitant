/**
 * Unit tests — Agent Loop Worker
 *
 * Validates:
 * - buildProfileContext() builds correct string from profile fields
 * - runAgentLoopWithWorker() delegates to runAgentLoop for continuations
 * - runAgentLoopWithWorker() falls back to runAgentLoop when worker unavailable
 * - runAgentLoopWithWorker() falls back on worker failure
 */

// ── Mocks ────────────────────────────────────────────────────────

const mockRunAgentLoop = jest.fn();
const mockMaybeUpdateThreadTitle = jest.fn().mockResolvedValue(undefined);
const mockPersistKnowledge = jest.fn().mockResolvedValue(undefined);
const mockDbMessagesToChat = jest.fn().mockReturnValue([]);

jest.mock("@/lib/agent/loop", () => ({
  runAgentLoop: (...args: unknown[]) => mockRunAgentLoop(...args),
  SYSTEM_PROMPT: "You are Nexus.",
  dbMessagesToChat: (...args: unknown[]) => mockDbMessagesToChat(...args),
  maybeUpdateThreadTitle: (...args: unknown[]) => mockMaybeUpdateThreadTitle(...args),
  persistKnowledgeFromTurn: (...args: unknown[]) => mockPersistKnowledge(...args),
}));

const mockIsWorkerAvailable = jest.fn();
const mockRunLlmInWorker = jest.fn();
const mockExecuteWithGatekeeper = jest.fn();

jest.mock("@/lib/agent/worker-manager", () => ({
  isWorkerAvailable: () => mockIsWorkerAvailable(),
  runLlmInWorker: (...args: unknown[]) => mockRunLlmInWorker(...args),
}));

jest.mock("@/lib/llm", () => ({
  selectProviderForWorker: jest.fn().mockReturnValue({
    providerType: "openai",
    providerLabel: "Azure GPT-5.2",
    providerConfig: { apiKey: "test-key", model: "gpt-5.2" },
    taskType: "simple",
    reason: "test routing",
  }),
}));

jest.mock("@/lib/mcp", () => ({
  getMcpManager: () => ({ getAllTools: () => [] }),
}));

jest.mock("@/lib/tools/web-tools", () => ({ BUILTIN_WEB_TOOLS: [] }));
jest.mock("@/lib/tools/browser-tools", () => ({ BUILTIN_BROWSER_TOOLS: [] }));
jest.mock("@/lib/tools/fs-tools", () => ({ BUILTIN_FS_TOOLS: [] }));
jest.mock("@/lib/tools/network-tools", () => ({ BUILTIN_NETWORK_TOOLS: [] }));
jest.mock("@/lib/tools/file-tools", () => ({ BUILTIN_FILE_TOOLS: [] }));
jest.mock("@/lib/tools/alexa-tools", () => ({ BUILTIN_ALEXA_TOOLS: [] }));
jest.mock("@/lib/tools/custom-tools", () => ({
  getCustomToolDefinitions: () => [],
}));

const mockGetUserProfile = jest.fn();
jest.mock("@/lib/db", () => ({
  getUserProfile: (...args: unknown[]) => mockGetUserProfile(...args),
  getUserById: jest.fn().mockReturnValue({ role: "admin" }),
  getThread: jest.fn().mockReturnValue({ id: "t1", status: "active" }),
  addMessage: jest.fn().mockReturnValue({ id: "msg-1", thread_id: "t1", role: "user", content: "" }),
  addAttachment: jest.fn(),
  getThreadMessages: jest.fn().mockReturnValue([]),
  addLog: jest.fn(),
  listToolPolicies: jest.fn().mockReturnValue([]),
}));

jest.mock("@/lib/knowledge/retriever", () => ({
  retrieveKnowledge: jest.fn().mockResolvedValue([]),
  hasKnowledgeEntries: jest.fn().mockReturnValue(false),
  needsKnowledgeRetrieval: jest.fn().mockReturnValue(false),
}));

jest.mock("@/lib/agent/gatekeeper", () => ({
  executeWithGatekeeper: (...args: unknown[]) => mockExecuteWithGatekeeper(...args),
}));

// Import module AFTER mocks are in place
import { runAgentLoopWithWorker } from "@/lib/agent/loop-worker";
// Import buildProfileContext by accessing it through the module (it's not exported, so we use
// a different approach — test indirectly through runAgentLoopWithWorker)

beforeEach(() => {
  jest.clearAllMocks();
});

// ── Tests ────────────────────────────────────────────────────────

describe("runAgentLoopWithWorker — fallback behavior", () => {
  const agentResult = {
    content: "Hello from main thread!",
    toolsUsed: [],
    pendingApprovals: [],
    attachments: [],
  };

  test("delegates to runAgentLoop for continuations", async () => {
    mockIsWorkerAvailable.mockReturnValue(true);
    mockRunAgentLoop.mockResolvedValue(agentResult);

    const result = await runAgentLoopWithWorker(
      "thread-1", "hi", undefined, undefined,
      true, // continuation = true
      "user-1"
    );

    expect(mockRunAgentLoop).toHaveBeenCalledWith(
      "thread-1", "hi", undefined, undefined,
      true, "user-1", undefined, undefined, undefined
    );
    expect(mockRunLlmInWorker).not.toHaveBeenCalled();
    expect(result).toEqual(agentResult);
  });

  test("delegates to runAgentLoop when worker unavailable", async () => {
    mockIsWorkerAvailable.mockReturnValue(false);
    mockRunAgentLoop.mockResolvedValue(agentResult);

    const result = await runAgentLoopWithWorker(
      "thread-2", "hello", undefined, undefined,
      false, "user-1"
    );

    expect(mockRunAgentLoop).toHaveBeenCalled();
    expect(mockRunLlmInWorker).not.toHaveBeenCalled();
    expect(result).toEqual(agentResult);
  });

  test("falls back to runAgentLoop when worker throws", async () => {
    mockIsWorkerAvailable.mockReturnValue(true);
    mockRunLlmInWorker.mockImplementation(() => {
      throw new Error("Worker spawn failed");
    });
    mockRunAgentLoop.mockResolvedValue(agentResult);

    const result = await runAgentLoopWithWorker(
      "thread-3", "test", undefined, undefined,
      false, "user-1"
    );

    expect(mockRunAgentLoop).toHaveBeenCalled();
    expect(result).toEqual(agentResult);
  });
});

describe("runAgentLoopWithWorker — worker path", () => {
  test("uses worker when available and not a continuation", async () => {
    mockIsWorkerAvailable.mockReturnValue(true);
    mockRunLlmInWorker.mockReturnValue({
      promise: Promise.resolve({
        content: "Hello from worker!",
        iterations: 1,
      }),
    });

    const result = await runAgentLoopWithWorker(
      "thread-4", "worker test", undefined, undefined,
      false, "user-1"
    );

    expect(mockRunLlmInWorker).toHaveBeenCalled();
    expect(mockRunAgentLoop).not.toHaveBeenCalled();
    expect(result.content).toBe("Hello from worker!");
  });

  test("persists tool-generated attachments from worker tool calls", async () => {
    const db = jest.requireMock("@/lib/db") as {
      addAttachment: jest.Mock;
      addMessage: jest.Mock;
    };

    mockIsWorkerAvailable.mockReturnValue(true);
    mockExecuteWithGatekeeper.mockResolvedValue({
      status: "executed",
      result: {
        status: "created",
        attachments: [
          {
            id: "att-1",
            filename: "report.pdf",
            mimeType: "application/pdf",
            sizeBytes: 1234,
            storagePath: "thread-7/att-1.pdf",
          },
        ],
      },
    });

    mockRunLlmInWorker.mockImplementation(
      (
        _config: Record<string, unknown>,
        _onToken: unknown,
        _onStatus: unknown,
        onToolRequest: (calls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>, assistantContent: string | null) => Promise<unknown>,
      ) => ({
        promise: (async () => {
          await onToolRequest(
            [
              {
                id: "tool-call-1",
                name: "builtin.file_generate",
                arguments: { filename: "report", format: "pdf" },
              },
            ],
            "Generating file",
          );
          return { content: "Done", iterations: 2 };
        })(),
      })
    );

    const result = await runAgentLoopWithWorker(
      "thread-7", "generate report", undefined, undefined,
      false, "user-1"
    );

    expect(mockExecuteWithGatekeeper).toHaveBeenCalled();
    expect(db.addAttachment).toHaveBeenCalled();
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].filename).toBe("report.pdf");
  });
});

describe("buildProfileContext — via system prompt integration", () => {
  // buildProfileContext is not exported, so test indirectly via the worker path
  // which builds the system prompt with profile context.

  test("system prompt includes profile fields when user has profile", async () => {
    mockIsWorkerAvailable.mockReturnValue(true);
    mockGetUserProfile.mockReturnValue({
      display_name: "John Doe",
      title: "Engineer",
      company: "Acme",
      location: "NYC",
      bio: null,
      email: "john@example.com",
      phone: null,
      website: null,
      linkedin: null,
      github: "johndoe",
      twitter: null,
      timezone: "America/New_York",
      languages: '["English","Arabic"]',
    });

    let capturedSystemPrompt = "";
    mockRunLlmInWorker.mockImplementation((config: Record<string, unknown>) => {
      capturedSystemPrompt = config.systemPrompt as string;
      return {
        promise: Promise.resolve({ content: "ok", iterations: 1 }),
      };
    });

    await runAgentLoopWithWorker(
      "thread-5", "hi", undefined, undefined,
      false, "user-with-profile"
    );

    expect(capturedSystemPrompt).toContain("Name: John Doe");
    expect(capturedSystemPrompt).toContain("Title: Engineer");
    expect(capturedSystemPrompt).toContain("Company: Acme");
    expect(capturedSystemPrompt).toContain("GitHub: johndoe");
    expect(capturedSystemPrompt).toContain("Timezone: America/New_York");
    expect(capturedSystemPrompt).toContain("Languages: English, Arabic");
  });

  test("system prompt omits profile section when user has no profile", async () => {
    mockIsWorkerAvailable.mockReturnValue(true);
    mockGetUserProfile.mockReturnValue(null);

    let capturedSystemPrompt = "";
    mockRunLlmInWorker.mockImplementation((config: Record<string, unknown>) => {
      capturedSystemPrompt = config.systemPrompt as string;
      return {
        promise: Promise.resolve({ content: "ok", iterations: 1 }),
      };
    });

    await runAgentLoopWithWorker(
      "thread-6", "hi", undefined, undefined,
      false, "no-profile-user"
    );

    expect(capturedSystemPrompt).not.toContain("<user_profile");
  });
});
