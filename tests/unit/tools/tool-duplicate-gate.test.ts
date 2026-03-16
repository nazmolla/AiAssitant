import { findDuplicateToolMatch } from "@/lib/tools/tool-duplicate-gate";
import type { ToolDefinition } from "@/lib/llm";

describe("findDuplicateToolMatch", () => {
  const existing: ToolDefinition[] = [
    {
      name: "custom.generate_invoice",
      description: "Generate invoice PDFs for customer orders and include line-item totals",
      inputSchema: {
        type: "object",
        properties: {
          orderId: { type: "string" },
          includeTaxes: { type: "boolean" },
        },
      },
    },
    {
      name: "builtin.web_search",
      description: "Search the web for public information",
      inputSchema: { type: "object", properties: { query: { type: "string" } } },
    },
  ];

  test("detects exact description duplicates", () => {
    const result = findDuplicateToolMatch(
      {
        name: "custom.invoice_creator",
        description: "Generate invoice PDFs for customer orders and include line-item totals",
        inputSchema: {
          type: "object",
          properties: {
            orderId: { type: "string" },
          },
        },
      },
      existing,
    );

    expect(result).not.toBeNull();
    expect(result?.toolName).toBe("custom.generate_invoice");
    expect(result?.reason).toBe("description-exact-match");
  });

  test("detects semantic duplicates with schema overlap", () => {
    const result = findDuplicateToolMatch(
      {
        name: "custom.invoice_from_order",
        description: "Create invoice pdf documents for orders including totals for each line item",
        inputSchema: {
          type: "object",
          properties: {
            orderId: { type: "string" },
            includeTaxes: { type: "boolean" },
          },
        },
      },
      existing,
    );

    expect(result).not.toBeNull();
    expect(result?.toolName).toBe("custom.generate_invoice");
    expect(result?.reason).toBe("description-schema-overlap");
    expect((result?.score ?? 0)).toBeGreaterThan(0.5);
  });

  test("ignores distinct tools", () => {
    const result = findDuplicateToolMatch(
      {
        name: "custom.summarize_news",
        description: "Summarize today news headlines from multiple public feeds",
        inputSchema: {
          type: "object",
          properties: {
            topic: { type: "string" },
          },
        },
      },
      existing,
    );

    expect(result).toBeNull();
  });
});
