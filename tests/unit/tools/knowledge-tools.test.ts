import { executeBuiltinKnowledgeTool, isKnowledgeTool, KNOWLEDGE_TOOL_NAMES } from "@/lib/tools/knowledge-tools";
import type { ToolExecutionContext } from "@/lib/tools/base-tool";

const mockRetrieveKnowledge = jest.fn();
const mockListKnowledge = jest.fn();
const mockSearchKnowledge = jest.fn();

jest.mock("@/lib/knowledge/retriever", () => ({
  retrieveKnowledge: (...args: unknown[]) => mockRetrieveKnowledge(...args),
}));

jest.mock("@/lib/db", () => ({
  listKnowledge: (...args: unknown[]) => mockListKnowledge(...args),
  searchKnowledge: (...args: unknown[]) => mockSearchKnowledge(...args),
}));

const ctx: ToolExecutionContext = { threadId: "t1", userId: "user-1" };
const noUserCtx: ToolExecutionContext = { threadId: "t1" };

const entry = (id: number, attr: string, value: string) => ({
  id,
  user_id: "user-1",
  entity: "Mohamed Nazmi",
  attribute: attr,
  value,
  source_type: "manual" as const,
  source_context: null,
  last_updated: "2026-04-28",
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRetrieveKnowledge.mockResolvedValue([]);
  mockListKnowledge.mockReturnValue([]);
  mockSearchKnowledge.mockReturnValue([]);
});

describe("isKnowledgeTool", () => {
  test("matches known tool names", () => {
    expect(isKnowledgeTool("builtin.knowledge_search")).toBe(true);
    expect(isKnowledgeTool("builtin.knowledge_list")).toBe(true);
  });

  test("does not match unrelated names", () => {
    expect(isKnowledgeTool("builtin.web_search")).toBe(false);
    expect(isKnowledgeTool("builtin.knowledge_delete")).toBe(false);
    expect(isKnowledgeTool("")).toBe(false);
  });

  test("KNOWLEDGE_TOOL_NAMES matches isKnowledgeTool", () => {
    for (const name of KNOWLEDGE_TOOL_NAMES) {
      expect(isKnowledgeTool(name)).toBe(true);
    }
  });
});

describe("builtin.knowledge_search", () => {
  test("returns error when no userId in context", async () => {
    const result = await executeBuiltinKnowledgeTool(
      "builtin.knowledge_search",
      { query: "career" },
      noUserCtx
    ) as { error: string };
    expect(result.error).toMatch(/no authenticated user/i);
    expect(mockRetrieveKnowledge).not.toHaveBeenCalled();
  });

  test("returns semantic results with count", async () => {
    mockRetrieveKnowledge.mockResolvedValue([
      entry(1, "job title", "Principal Architect"),
      entry(2, "company", "Long View Systems"),
    ]);

    const result = await executeBuiltinKnowledgeTool(
      "builtin.knowledge_search",
      { query: "career" },
      ctx
    ) as { count: number; entries: unknown[] };

    expect(result.count).toBe(2);
    expect(result.entries).toHaveLength(2);
  });

  test("fills remaining slots from keyword fallback when semantic returns fewer", async () => {
    mockRetrieveKnowledge.mockResolvedValue([entry(1, "job title", "Principal Architect")]);
    mockSearchKnowledge.mockReturnValue([
      entry(1, "job title", "Principal Architect"), // duplicate — should be filtered
      entry(2, "company", "Long View Systems"),     // new — should be included
    ]);

    const result = await executeBuiltinKnowledgeTool(
      "builtin.knowledge_search",
      { query: "career", limit: 5 },
      ctx
    ) as { count: number; entries: { attribute: string }[] };

    expect(result.count).toBe(2);
    expect(result.entries.map((e) => e.attribute)).toContain("company");
  });

  test("caps limit at 30", async () => {
    mockRetrieveKnowledge.mockResolvedValue([]);
    await executeBuiltinKnowledgeTool(
      "builtin.knowledge_search",
      { query: "anything", limit: 999 },
      ctx
    );
    expect(mockRetrieveKnowledge).toHaveBeenCalledWith("anything", 30, "user-1");
  });

  test("uses default limit 12 when not specified", async () => {
    mockRetrieveKnowledge.mockResolvedValue([]);
    await executeBuiltinKnowledgeTool("builtin.knowledge_search", { query: "x" }, ctx);
    expect(mockRetrieveKnowledge).toHaveBeenCalledWith("x", 12, "user-1");
  });
});

describe("builtin.knowledge_list", () => {
  test("returns error when no userId in context", async () => {
    const result = await executeBuiltinKnowledgeTool(
      "builtin.knowledge_list",
      {},
      noUserCtx
    ) as { error: string };
    expect(result.error).toMatch(/no authenticated user/i);
    expect(mockListKnowledge).not.toHaveBeenCalled();
  });

  test("returns all entries when no entity filter", async () => {
    mockListKnowledge.mockReturnValue([
      entry(1, "name", "Mohamed Nazmi"),
      entry(2, "company", "Long View Systems"),
    ]);

    const result = await executeBuiltinKnowledgeTool(
      "builtin.knowledge_list",
      {},
      ctx
    ) as { total: number; entityFilter: null; entries: unknown[] };

    expect(result.total).toBe(2);
    expect(result.entityFilter).toBeNull();
  });

  test("filters entries by entity name (case-insensitive)", async () => {
    mockListKnowledge.mockReturnValue([
      { ...entry(1, "name", "Mohamed Nazmi"), entity: "Mohamed Nazmi" },
      { ...entry(2, "company", "Long View"), entity: "Long View Systems" },
    ]);

    const result = await executeBuiltinKnowledgeTool(
      "builtin.knowledge_list",
      { entity: "Mohamed" },
      ctx
    ) as { total: number; entries: { attribute: string }[] };

    expect(result.total).toBe(1);
    expect(result.entries[0].attribute).toBe("name");
  });

  test("caps limit at 200", async () => {
    mockListKnowledge.mockReturnValue([]);
    await executeBuiltinKnowledgeTool(
      "builtin.knowledge_list",
      { limit: 9999 },
      ctx
    );
    expect(mockListKnowledge).toHaveBeenCalledWith("user-1", 200);
  });

  test("throws on unknown tool name", async () => {
    await expect(
      executeBuiltinKnowledgeTool("builtin.knowledge_unknown", {}, ctx)
    ).rejects.toThrow("Unknown knowledge tool");
  });
});
