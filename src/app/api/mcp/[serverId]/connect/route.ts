import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { getMcpManager } from "@/lib/mcp";
import { getMcpServer, upsertToolPolicy, getToolPolicy } from "@/lib/db";

export async function POST(
  _req: NextRequest,
  { params }: { params: { serverId: string } }
) {
  const denied = await requireOwner();
  if (denied) return denied;

  const server = getMcpServer(params.serverId);
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
        });
      }
    }

    return NextResponse.json({
      success: true,
      tools: connection.tools,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { serverId: string } }
) {
  const denied = await requireOwner();
  if (denied) return denied;

  const mcpManager = getMcpManager();
  await mcpManager.disconnect(params.serverId);
  return NextResponse.json({ success: true });
}
