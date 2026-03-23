/**
 * Unit tests — expandMultiToolUse
 *
 * Verifies that OpenAI's synthetic `multi_tool_use.parallel` tool call
 * is correctly expanded into individual tool calls.
 */

import { expandMultiToolUse } from "@/lib/agent/discovery";
import type { ToolCall } from "@/lib/llm";

describe("expandMultiToolUse", () => {
  test("passes through regular tool calls unchanged", () => {
    const calls: ToolCall[] = [
      { id: "tc_1", name: "builtin.web_search", arguments: { query: "test" } },
      { id: "tc_2", name: "builtin.net_ping", arguments: { host: "1.1.1.1" } },
    ];

    const result = expandMultiToolUse(calls);
    expect(result).toEqual(calls);
    expect(result).toHaveLength(2);
  });

  test("expands multi_tool_use.parallel into individual calls", () => {
    const calls: ToolCall[] = [
      {
        id: "tc_multi",
        name: "multi_tool_use.parallel",
        arguments: {
          tool_uses: [
            { recipient_name: "functions.builtin.web_search", parameters: { query: "weather" } },
            { recipient_name: "functions.builtin.net_ping", parameters: { host: "8.8.8.8" } },
          ],
        },
      },
    ];

    const result = expandMultiToolUse(calls);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      id: "tc_multi_0",
      name: "builtin.web_search",
      arguments: { query: "weather" },
    });
    expect(result[1]).toEqual({
      id: "tc_multi_1",
      name: "builtin.net_ping",
      arguments: { host: "8.8.8.8" },
    });
  });

  test("expands bare multi_tool_use (without .parallel suffix)", () => {
    const calls: ToolCall[] = [
      {
        id: "tc_bare",
        name: "multi_tool_use",
        arguments: {
          tool_uses: [
            { recipient_name: "functions.builtin.fs_read", parameters: { path: "/tmp" } },
          ],
        },
      },
    ];

    const result = expandMultiToolUse(calls);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("builtin.fs_read");
    expect(result[0].id).toBe("tc_bare_0");
  });

  test("handles mixed regular and multi_tool_use calls", () => {
    const calls: ToolCall[] = [
      { id: "tc_1", name: "builtin.web_search", arguments: { q: "x" } },
      {
        id: "tc_multi",
        name: "multi_tool_use.parallel",
        arguments: {
          tool_uses: [
            { recipient_name: "functions.builtin.net_ping", parameters: { host: "1.1.1.1" } },
            { recipient_name: "functions.builtin.net_ping", parameters: { host: "8.8.8.8" } },
          ],
        },
      },
      { id: "tc_3", name: "builtin.net_ping", arguments: { host: "1.1.1.1" } },
    ];

    const result = expandMultiToolUse(calls);
    expect(result).toHaveLength(4);
    expect(result[0].name).toBe("builtin.web_search");
    expect(result[1].name).toBe("builtin.net_ping");
    expect(result[2].name).toBe("builtin.net_ping");
    expect(result[3].name).toBe("builtin.net_ping");
  });

  test("strips functions. prefix from recipient_name", () => {
    const calls: ToolCall[] = [
      {
        id: "tc_1",
        name: "multi_tool_use.parallel",
        arguments: {
          tool_uses: [
            { recipient_name: "functions.srv-001.some_tool", parameters: {} },
          ],
        },
      },
    ];

    const result = expandMultiToolUse(calls);
    expect(result[0].name).toBe("srv-001.some_tool");
  });

  test("handles recipient_name without functions. prefix", () => {
    const calls: ToolCall[] = [
      {
        id: "tc_1",
        name: "multi_tool_use.parallel",
        arguments: {
          tool_uses: [
            { recipient_name: "builtin.web_search", parameters: { q: "test" } },
          ],
        },
      },
    ];

    const result = expandMultiToolUse(calls);
    expect(result[0].name).toBe("builtin.web_search");
  });

  test("skips entries with empty or missing recipient_name", () => {
    const calls: ToolCall[] = [
      {
        id: "tc_1",
        name: "multi_tool_use.parallel",
        arguments: {
          tool_uses: [
            { recipient_name: "", parameters: {} },
            { recipient_name: "functions.builtin.web_search", parameters: {} },
            { parameters: {} },
          ],
        },
      },
    ];

    const result = expandMultiToolUse(calls);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("builtin.web_search");
  });

  test("handles missing tool_uses gracefully", () => {
    const calls: ToolCall[] = [
      { id: "tc_1", name: "multi_tool_use.parallel", arguments: {} },
    ];

    const result = expandMultiToolUse(calls);
    expect(result).toHaveLength(0);
  });

  test("uses empty object for missing parameters", () => {
    const calls: ToolCall[] = [
      {
        id: "tc_1",
        name: "multi_tool_use.parallel",
        arguments: {
          tool_uses: [
            { recipient_name: "functions.builtin.web_search" },
          ],
        },
      },
    ];

    const result = expandMultiToolUse(calls);
    expect(result[0].arguments).toEqual({});
  });

  test("returns empty array for empty input", () => {
    const result = expandMultiToolUse([]);
    expect(result).toEqual([]);
  });
});
