import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { listMcpServers, upsertMcpServer, deleteMcpServer } from "@/lib/db";
import { getMcpManager } from "@/lib/mcp";

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;

  const servers = listMcpServers();
  const mcpManager = getMcpManager();

  const serversWithStatus = servers.map((s) => ({
    ...s,
    connected: mcpManager.isConnected(s.id),
  }));

  return NextResponse.json(serversWithStatus);
}

export async function POST(req: NextRequest) {
  const denied = await requireOwner();
  if (denied) return denied;

  const body = await req.json();
  const { id, name, transport_type, command, args, env_vars } = body;

  if (!id || !name || !command) {
    return NextResponse.json(
      { error: "id, name, and command are required." },
      { status: 400 }
    );
  }

  upsertMcpServer({
    id,
    name,
    transport_type: transport_type || "stdio",
    command,
    args: args ? JSON.stringify(args) : null,
    env_vars: env_vars ? JSON.stringify(env_vars) : null,
  });

  return NextResponse.json({ success: true }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireOwner();
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const mcpManager = getMcpManager();
  if (mcpManager.isConnected(id)) {
    await mcpManager.disconnect(id);
  }

  deleteMcpServer(id);
  return NextResponse.json({ success: true });
}
