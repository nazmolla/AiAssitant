import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { listMcpServers, upsertMcpServer, deleteMcpServer } from "@/lib/db";
import { getMcpManager } from "@/lib/mcp";

export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const servers = listMcpServers(auth.user.id);
  const mcpManager = getMcpManager();

  const serversWithStatus = servers.map((s) => ({
    ...s,
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

  if (!id || !name) {
    return NextResponse.json(
      { error: "id and name are required." },
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

  const mcpManager = getMcpManager();
  if (mcpManager.isConnected(id)) {
    await mcpManager.disconnect(id);
  }

  deleteMcpServer(id);
  return NextResponse.json({ success: true });
}
