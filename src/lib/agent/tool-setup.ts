/**
 * Tool list assembly and scope filtering for the agent loop.
 * Builds the combined tool list (builtin + custom + MCP) and
 * filters by user role/scope.
 *
 * Extracted from loop.ts for SRP compliance.
 */

import type { ToolDefinition } from "@/lib/llm";
import { getMcpManager } from "@/lib/mcp";
import { BUILTIN_WEB_TOOLS } from "./web-tools";
import { BUILTIN_BROWSER_TOOLS } from "./browser-tools";
import { BUILTIN_FS_TOOLS } from "./fs-tools";
import { BUILTIN_NETWORK_TOOLS } from "./network-tools";
import { BUILTIN_EMAIL_TOOLS } from "./email-tools";
import { BUILTIN_FILE_TOOLS } from "./file-tools";
import { BUILTIN_ALEXA_TOOLS } from "./alexa-tools";
import { buildCappedToolList } from "./tool-cap";
import { getUserById, listToolPolicies } from "@/lib/db";

/**
 * Build the full tool list (builtin + custom + MCP) and filter by user scope.
 * Non-admin users only see tools whose policy scope is not "user"-restricted.
 */
export async function buildFilteredToolList(userId?: string): Promise<ToolDefinition[]> {
  const mcpManager = getMcpManager();
  const mcpTools = mcpManager.getAllTools();

  const { getCustomToolDefinitions } = await import("./custom-tools");
  const customTools = getCustomToolDefinitions();

  const builtinTools = [
    ...BUILTIN_WEB_TOOLS,
    ...BUILTIN_BROWSER_TOOLS,
    ...BUILTIN_FS_TOOLS,
    ...BUILTIN_NETWORK_TOOLS,
    ...BUILTIN_EMAIL_TOOLS,
    ...BUILTIN_FILE_TOOLS,
    ...BUILTIN_ALEXA_TOOLS,
  ];

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
