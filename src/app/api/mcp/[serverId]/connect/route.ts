import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getMcpManager } from "@/lib/mcp";
import { getMcpServer, upsertToolPolicy, getToolPolicy } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const { serverId } = await params;
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const server = getMcpServer(serverId);
  if (!server) {
    return NextResponse.json({ error: "MCP server not found." }, { status: 404 });
  }

  try {
    const mcpManager = getMcpManager();
    const connection = await mcpManager.connect(server);

    // Auto-create tool policies for discovered tools (default: requires approval, not proactive)
    for (const tool of connection.tools) {
      const existing = getToolPolicy(tool.name);
      if (!existing) {
        upsertToolPolicy({
          tool_name: tool.name,
          mcp_id: server.id,
          requires_approval: 1,
          is_proactive_enabled: 0,
          scope: "global",
        });
      }
    }

    return NextResponse.json({
      success: true,
      tools: connection.tools,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    // Sanitize error: strip internal paths and stack traces
    const safeMsg = errorMsg.split("\n")[0].replace(/\/home\/[^\s]+/g, "[path]").replace(/[A-Z]:\\[^\s]+/g, "[path]");
    return NextResponse.json({ error: safeMsg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ serverId: string }> }
) {
  const { serverId } = await params;
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const mcpManager = getMcpManager();
  await mcpManager.disconnect(serverId);
  return NextResponse.json({ success: true });
}
