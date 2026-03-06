import { sanitizeToolName, sanitizeToolSchema } from "@/lib/llm/openai-provider";

describe("sanitizeToolName", () => {
  it("returns simple alphanumeric names unchanged", () => {
    expect(sanitizeToolName("web_search")).toBe("web_search");
  });

  it("allows hyphens and underscores", () => {
    expect(sanitizeToolName("my-tool_v2")).toBe("my-tool_v2");
  });

  it("replaces dots with underscores (MCP qualified names)", () => {
    expect(sanitizeToolName("github.list_repos")).toBe("github_list_repos");
  });

  it("replaces multiple dots", () => {
    expect(sanitizeToolName("mcp.server.tool.action")).toBe("mcp_server_tool_action");
  });

  it("replaces spaces and special characters", () => {
    expect(sanitizeToolName("my tool!@#$%")).toBe("my_tool_____");
  });

  it("truncates names longer than 64 characters", () => {
    const longName = "a".repeat(100);
    expect(sanitizeToolName(longName)).toHaveLength(64);
  });

  it("handles empty string", () => {
    expect(sanitizeToolName("")).toBe("");
  });
});

describe("sanitizeToolSchema", () => {
  it("adds type: 'object' when missing", () => {
    const result = sanitizeToolSchema({});
    expect(result.type).toBe("object");
    expect(result.properties).toEqual({});
  });

  it("preserves existing type", () => {
    const result = sanitizeToolSchema({ type: "object", properties: { q: { type: "string" } } });
    expect(result.type).toBe("object");
    expect(result.properties).toEqual({ q: { type: "string" } });
  });

  it("adds properties when missing", () => {
    const result = sanitizeToolSchema({ type: "object" });
    expect(result.properties).toEqual({});
  });

  it("strips $schema", () => {
    const result = sanitizeToolSchema({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: {},
    });
    expect(result.$schema).toBeUndefined();
  });

  it("strips additionalProperties", () => {
    const result = sanitizeToolSchema({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
    expect(result.additionalProperties).toBeUndefined();
  });

  it("preserves required and description fields", () => {
    const result = sanitizeToolSchema({
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      description: "Search params",
    });
    expect(result.required).toEqual(["query"]);
    expect(result.description).toBe("Search params");
  });

  it("does not mutate the original schema", () => {
    const original = { $schema: "http://json-schema.org/draft-07/schema#" };
    sanitizeToolSchema(original);
    expect(original.$schema).toBeDefined();
  });
});
