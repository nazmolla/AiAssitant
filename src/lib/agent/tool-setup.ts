/**
 * Tool list assembly and scope filtering for the agent loop.
 * Builds the combined tool list (builtin + custom + MCP) and
 * filters by user role/scope.
 *
 * Extracted from loop.ts for SRP compliance.
 */

import type { ToolDefinition } from "@/lib/llm";
import { getMcpManager } from "@/lib/mcp";
import { ALL_TOOL_CATEGORIES, buildCappedToolList } from "@/lib/tools";
import { getUserById } from "@/lib/db/user-queries";
import { listToolPolicies } from "@/lib/db/tool-policy-queries";

/**
 * Build the full tool list (builtin + custom + MCP) and filter by user scope.
 * Non-admin users only see tools whose policy scope is not "user"-restricted.
 */
export async function buildFilteredToolList(userId?: string): Promise<ToolDefinition[]> {
  const mcpManager = getMcpManager();
  const mcpTools = mcpManager.getAllTools();

  const { getCustomToolDefinitions } = await import("@/lib/tools/custom-tools");
  const customTools = getCustomToolDefinitions();

  // Use auto-discovered tool categories (in dispatch order)
  const builtinTools = ALL_TOOL_CATEGORIES.flatMap((category) => category.tools);

  const allTools = buildCappedToolList(builtinTools, customTools, mcpTools);

  // Filter tools by scope: non-admin users only see non-restricted tools
  const isAdmin = userId ? getUserById(userId)?.role === "admin" : true;
  if (isAdmin) return allTools;

  const policyMap = new Map(listToolPolicies().map((p) => [p.tool_name, p]));
  return allTools.filter((t) => {
    const policy = policyMap.get(t.name);
    return !policy || policy.scope !== "user";
  });
}
