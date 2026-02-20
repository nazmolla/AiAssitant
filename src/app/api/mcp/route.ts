import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { listMcpServers, upsertMcpServer, deleteMcpServer, getMcpServer } from "@/lib/db";
import { getMcpManager } from "@/lib/mcp";

export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const servers = listMcpServers(auth.user.id);
  const mcpManager = getMcpManager();

  // Redact secrets before sending to client
  const serversWithStatus = servers.map((s) => ({
    ...s,
    access_token: s.access_token ? "••••••" : null,
    client_secret: s.client_secret ? "••••••" : null,
    connected: mcpManager.isConnected(s.id),
  }));

  return NextResponse.json(serversWithStatus);
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const body = await req.json();
  const { id, name, transport_type, command, args, env_vars, url, auth_type, access_token, client_id, client_secret, scope } = body;

  const transport = transport_type || "stdio";
  const isStdio = transport === "stdio";
  const serverScope = scope || "global";

  // Only admins can create global servers
  if (serverScope === "global" && auth.user.role !== "admin") {
    return NextResponse.json(
      { error: "Only admins can create global MCP servers." },
      { status: 403 }
    );
  }

  // Validate server ID format (prevent overwriting via user-controlled ID)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!id || !name || !UUID_RE.test(id)) {
    return NextResponse.json(
      { error: "Valid UUID id and name are required." },
      { status: 400 }
    );
  }

  if (isStdio && !command) {
    return NextResponse.json(
      { error: "command is required for stdio transport." },
      { status: 400 }
    );
  }

  if (!isStdio && !url && !command) {
    return NextResponse.json(
      { error: "url is required for HTTP-based transports." },
      { status: 400 }
    );
  }

  upsertMcpServer({
    id,
    name,
    transport_type: transport,
    command: command || null,
    args: args ? JSON.stringify(args) : null,
    env_vars: env_vars ? JSON.stringify(env_vars) : null,
    url: url || null,
    auth_type: auth_type || "none",
    access_token: access_token || null,
    client_id: client_id || null,
    client_secret: client_secret || null,
    user_id: serverScope === "user" ? auth.user.id : null,
    scope: serverScope,
  });

  return NextResponse.json({ success: true }, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  // Verify ownership: only admin can delete global servers, users can only delete their own
  const server = getMcpServer(id);
  if (!server) {
    return NextResponse.json({ error: "Server not found." }, { status: 404 });
  }
  if (server.scope === "global" && auth.user.role !== "admin") {
    return NextResponse.json({ error: "Only admins can delete global servers." }, { status: 403 });
  }
  if (server.scope === "user" && server.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const mcpManager = getMcpManager();
  if (mcpManager.isConnected(id)) {
    await mcpManager.disconnect(id);
  }

  deleteMcpServer(id);
  return NextResponse.json({ success: true });
}
