/**
 * Unit tests — Custom Tools logic (isCustomTool, executeCustomTool, getCustomToolDefinitions)
 */
import { setupTestDb, teardownTestDb } from "../../helpers/test-db";
import {
  isCustomTool,
  executeCustomTool,
  getCustomToolDefinitions,
  loadCustomToolsFromDb,
  validateImplementation,
  BUILTIN_TOOLMAKER_TOOLS,
} from "@/lib/tools/custom-tools";
import { createCustomToolRecord, getToolPolicy } from "@/lib/db/queries";

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
    expect(isCustomTool("builtin.nexus_update_tool")).toBe(true);
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

  test("creating a custom tool auto-creates a policy entry", () => {
    const policy = getToolPolicy("custom.my_adder");
    expect(policy).toBeDefined();
    expect(policy!.tool_name).toBe("custom.my_adder");
    expect(policy!.requires_approval).toBe(0);
  });

  test("create tool rejects duplicates with guidance to use update", async () => {
    await expect(
      executeCustomTool("builtin.nexus_create_tool", {
        toolName: "my_adder",
        description: "Another adder",
        inputSchema: { type: "object", properties: {} },
        implementation: "return {};",
      })
    ).rejects.toThrow(/already exists.*nexus_update_tool/);
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

  test("update tool modifies implementation", async () => {
    const result = (await executeCustomTool("builtin.nexus_update_tool", {
      toolName: "my_adder",
      implementation: "return { product: args.a * args.b };",
    })) as any;

    expect(result.status).toBe("updated");
    expect(result.fieldsUpdated).toContain("implementation");

    // Verify the updated code runs
    const execResult = (await executeCustomTool("custom.my_adder", { a: 3, b: 7 })) as any;
    expect(execResult).toEqual({ product: 21 });
  });

  test("update tool modifies description", async () => {
    const result = (await executeCustomTool("builtin.nexus_update_tool", {
      toolName: "custom.my_adder",
      description: "Multiply numbers",
    })) as any;

    expect(result.status).toBe("updated");
    expect(result.fieldsUpdated).toContain("description");
  });

  test("update tool rejects bad implementation", async () => {
    await expect(
      executeCustomTool("builtin.nexus_update_tool", {
        toolName: "my_adder",
        implementation: "const x = {{;",
      })
    ).rejects.toThrow(/syntax/i);
  });

  test("update nonexistent tool throws with guidance", async () => {
    await expect(
      executeCustomTool("builtin.nexus_update_tool", {
        toolName: "nonexistent_tool",
        implementation: "return {};",
      })
    ).rejects.toThrow(/not found.*nexus_create_tool/);
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

  test("deleting a custom tool also removes its policy entry", () => {
    const policy = getToolPolicy("custom.my_adder");
    expect(policy).toBeUndefined();
  });

  test("delete nonexistent tool throws", async () => {
    await expect(
      executeCustomTool("builtin.nexus_delete_custom_tool", { toolName: "nope" })
    ).rejects.toThrow(/not found/);
  });
});

describe("validateImplementation", () => {
  test("returns null for valid code", () => {
    expect(validateImplementation("return { ok: true };")).toBeNull();
  });

  test("returns null for async code with fetch", () => {
    expect(validateImplementation("const r = await fetch('http://example.com'); return { status: r.status };")).toBeNull();
  });

  test("returns error for syntax errors", () => {
    const error = validateImplementation("const x = {{;");
    expect(error).not.toBeNull();
    expect(error).toMatch(/syntax/i);
  });

  test("returns error for code using unavailable globals like process", () => {
    const error = validateImplementation("return process.env.SECRET;");
    expect(error).not.toBeNull();
    expect(error).toMatch(/not available in the sandbox/);
  });

  test("returns error for code using require", () => {
    const error = validateImplementation("const fs = require('fs'); return fs;");
    expect(error).not.toBeNull();
    expect(error).toMatch(/not available in the sandbox/);
  });
});
