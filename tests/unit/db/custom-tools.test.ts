/**
 * Unit tests — Custom Tools (DB CRUD + in-memory cache)
 */
import { setupTestDb, teardownTestDb } from "../../helpers/test-db";
import {
  listCustomTools,
  getCustomTool,
  createCustomToolRecord,
  updateCustomToolEnabled,
  deleteCustomToolRecord,
} from "@/lib/db/queries";

beforeAll(() => {
  setupTestDb();
});
afterAll(() => teardownTestDb());

describe("Custom Tools DB", () => {
  test("starts with no custom tools", () => {
    const tools = listCustomTools();
    expect(tools).toEqual([]);
  });

  test("createCustomToolRecord inserts a tool", () => {
    const record = createCustomToolRecord({
      name: "custom.test_add",
      description: "Adds two numbers",
      inputSchema: JSON.stringify({
        type: "object",
        properties: { a: { type: "number" }, b: { type: "number" } },
        required: ["a", "b"],
      }),
      implementation: "return { sum: args.a + args.b };",
    });

    expect(record).toBeDefined();
    expect(record.name).toBe("custom.test_add");
    expect(record.description).toBe("Adds two numbers");
    expect(record.enabled).toBe(1);
  });

  test("getCustomTool returns the created tool", () => {
    const tool = getCustomTool("custom.test_add");
    expect(tool).toBeDefined();
    expect(tool!.name).toBe("custom.test_add");
    expect(tool!.implementation).toBe("return { sum: args.a + args.b };");
  });

  test("listCustomTools includes the tool", () => {
    const tools = listCustomTools();
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe("custom.test_add");
  });

  test("updateCustomToolEnabled disables a tool", () => {
    updateCustomToolEnabled("custom.test_add", false);
    const tool = getCustomTool("custom.test_add");
    expect(tool!.enabled).toBe(0);
  });

  test("updateCustomToolEnabled re-enables a tool", () => {
    updateCustomToolEnabled("custom.test_add", true);
    const tool = getCustomTool("custom.test_add");
    expect(tool!.enabled).toBe(1);
  });

  test("createCustomToolRecord can add a second tool", () => {
    createCustomToolRecord({
      name: "custom.format_date",
      description: "Formats a date string",
      inputSchema: JSON.stringify({
        type: "object",
        properties: { date: { type: "string" } },
        required: ["date"],
      }),
      implementation: "return { formatted: new Date(args.date).toISOString() };",
    });
    const tools = listCustomTools();
    expect(tools.length).toBe(2);
  });

  test("deleteCustomToolRecord removes a tool", () => {
    deleteCustomToolRecord("custom.format_date");
    const tools = listCustomTools();
    expect(tools.length).toBe(1);
    expect(getCustomTool("custom.format_date")).toBeUndefined();
  });

  test("getCustomTool returns undefined for nonexistent tool", () => {
    expect(getCustomTool("custom.nonexistent")).toBeUndefined();
  });
});
