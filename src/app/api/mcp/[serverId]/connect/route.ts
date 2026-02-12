import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { getMcpManager } from "@/lib/mcp";
import { getMcpServer } from "@/lib/db";

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
