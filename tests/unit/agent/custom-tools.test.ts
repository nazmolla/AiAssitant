/**
 * Unit tests — Custom Tools logic (isCustomTool, executeCustomTool, getCustomToolDefinitions)
 */
import { setupTestDb, teardownTestDb } from "../../helpers/test-db";
import {
  isCustomTool,
  executeCustomTool,
  getCustomToolDefinitions,
  loadCustomToolsFromDb,
  BUILTIN_TOOLMAKER_TOOLS,
} from "@/lib/agent/custom-tools";
import { createCustomToolRecord } from "@/lib/db/queries";

beforeAll(() => {
  setupTestDb();
});
afterAll(() => teardownTestDb());

describe("isCustomTool", () => {
  test("recognises custom.* prefixed tools", () => {
    expect(isCustomTool("custom.calculate_bmi")).toBe(true);
    expect(isCustomTool("custom.x")).toBe(true);
  });

  test("recognises builtin toolmaker tools", () => {
    expect(isCustomTool("builtin.nexus_create_tool")).toBe(true);
    expect(isCustomTool("builtin.nexus_list_custom_tools")).toBe(true);
    expect(isCustomTool("builtin.nexus_delete_custom_tool")).toBe(true);
  });

  test("rejects non-custom tools", () => {
    expect(isCustomTool("web_search")).toBe(false);
    expect(isCustomTool("builtin.browser_navigate")).toBe(false);
    expect(isCustomTool("fs_read_file")).toBe(false);
  });
});

describe("getCustomToolDefinitions", () => {
  test("always includes the 3 builtin toolmaker tools", () => {
    loadCustomToolsFromDb();
    const defs = getCustomToolDefinitions();
    expect(defs.length).toBeGreaterThanOrEqual(BUILTIN_TOOLMAKER_TOOLS.length);
    const names = defs.map((d) => d.name);
    expect(names).toContain("builtin.nexus_create_tool");
    expect(names).toContain("builtin.nexus_list_custom_tools");
    expect(names).toContain("builtin.nexus_delete_custom_tool");
  });

  test("includes enabled custom tools after insertion", () => {
    createCustomToolRecord({
      name: "custom.unit_test_tool",
      description: "For testing",
      inputSchema: JSON.stringify({ type: "object", properties: {} }),
      implementation: "return { ok: true };",
    });
    loadCustomToolsFromDb();
    const defs = getCustomToolDefinitions();
    const names = defs.map((d) => d.name);
    expect(names).toContain("custom.unit_test_tool");
  });
});

describe("executeCustomTool", () => {
  test("list tools returns current tools", async () => {
    loadCustomToolsFromDb();
    const result = (await executeCustomTool("builtin.nexus_list_custom_tools", {})) as any;
    expect(result).toHaveProperty("tools");
    expect(result).toHaveProperty("count");
    expect(result.count).toBeGreaterThanOrEqual(1);
  });

  test("create tool validates missing fields", async () => {
    await expect(
      executeCustomTool("builtin.nexus_create_tool", { toolName: "bad" })
    ).rejects.toThrow(/Missing required fields/);
  });

  test("create tool validates inputSchema type", async () => {
    await expect(
      executeCustomTool("builtin.nexus_create_tool", {
        toolName: "bad_schema_tool",
        description: "test",
        inputSchema: { type: "string" }, // wrong: should be "object"
        implementation: "return {};",
      })
    ).rejects.toThrow(/type.*object/i);
  });

  test("create tool validates syntax errors", async () => {
    await expect(
      executeCustomTool("builtin.nexus_create_tool", {
        toolName: "syntax_bad",
        description: "test",
        inputSchema: { type: "object", properties: {} },
        implementation: "const x = {{{;",
      })
    ).rejects.toThrow(/syntax/i);
  });

  test("create tool succeeds with valid input", async () => {
    const result = (await executeCustomTool("builtin.nexus_create_tool", {
      toolName: "my_adder",
      description: "Add numbers",
      inputSchema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } } },
      implementation: "return { sum: args.a + args.b };",
    })) as any;

    expect(result.status).toBe("created");
    expect(result.toolName).toBe("custom.my_adder");
  });

  test("create tool rejects duplicates", async () => {
    await expect(
      executeCustomTool("builtin.nexus_create_tool", {
        toolName: "my_adder",
        description: "Another adder",
        inputSchema: { type: "object", properties: {} },
        implementation: "return {};",
      })
    ).rejects.toThrow(/already exists/);
  });

  test("execute custom tool runs sandboxed code", async () => {
    const result = (await executeCustomTool("custom.my_adder", { a: 10, b: 32 })) as any;
    expect(result).toEqual({ sum: 42 });
  });

  test("execute nonexistent tool throws", async () => {
    await expect(
      executeCustomTool("custom.nonexistent_xyz", {})
    ).rejects.toThrow(/not found or is disabled/);
  });

  test("delete tool removes it", async () => {
    const result = (await executeCustomTool("builtin.nexus_delete_custom_tool", {
      toolName: "my_adder",
    })) as any;
    expect(result.status).toBe("deleted");

    // Verify it's gone
    await expect(
      executeCustomTool("custom.my_adder", { a: 1, b: 2 })
    ).rejects.toThrow(/not found or is disabled/);
  });

  test("delete nonexistent tool throws", async () => {
    await expect(
      executeCustomTool("builtin.nexus_delete_custom_tool", { toolName: "nope" })
    ).rejects.toThrow(/not found/);
  });
});
