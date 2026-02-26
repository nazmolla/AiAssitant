import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getMcpManager } from "@/lib/mcp";
import { BUILTIN_WEB_TOOLS } from "@/lib/agent/web-tools";
import { BUILTIN_BROWSER_TOOLS } from "@/lib/agent/browser-tools";
import { BUILTIN_FS_TOOLS } from "@/lib/agent/fs-tools";
import { BUILTIN_NETWORK_TOOLS } from "@/lib/agent/network-tools";
import { getCustomToolDefinitions } from "@/lib/agent/custom-tools";

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  // MCP tools (from connected servers)
  const mcpTools = getMcpManager().getAllTools();

  // Built-in tools grouped by category
  const builtinTools = [
    ...BUILTIN_WEB_TOOLS.map((t) => ({ ...t, source: "builtin", group: "Web Tools" })),
    ...BUILTIN_BROWSER_TOOLS.map((t) => ({ ...t, source: "builtin", group: "Browser Tools" })),
    ...BUILTIN_FS_TOOLS.map((t) => ({ ...t, source: "builtin", group: "File System" })),
    ...BUILTIN_NETWORK_TOOLS.map((t) => ({ ...t, source: "builtin", group: "Network Tools" })),
  ];

  // Custom (agent-created) tools + toolmaker built-ins
  const customTools = getCustomToolDefinitions().map((t) => ({
    ...t,
    source: t.name.startsWith("builtin.") ? "builtin" : "custom",
    group: t.name.startsWith("builtin.") ? "Tool Management" : "Custom Tools",
  }));

  // MCP tools with source markers
  const mcpMarked = mcpTools.map((t: any) => ({ ...t, source: "mcp" }));

  return NextResponse.json([...builtinTools, ...customTools, ...mcpMarked]);
}
