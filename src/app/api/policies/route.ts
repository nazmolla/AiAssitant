import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { listToolPolicies, upsertToolPolicy } from "@/lib/db";
import { defaultRequiresApproval, discoverAllTools } from "@/lib/agent/discovery";

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const tools = discoverAllTools();
  const existing = new Map(listToolPolicies().map((p) => [p.tool_name, p]));

  for (const tool of tools) {
    if (existing.has(tool.name)) continue;
    upsertToolPolicy({
      tool_name: tool.name,
      mcp_id: tool.source === "mcp" ? tool.name.split(".")[0] || null : null,
      requires_approval: defaultRequiresApproval(tool.name, tool.source),
      scope: "global",
    });
  }

  const policies = listToolPolicies();
  return NextResponse.json(policies);
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await req.json();
  const { tool_name, mcp_id, requires_approval, scope } = body;

  if (!tool_name) {
    return NextResponse.json({ error: "tool_name is required." }, { status: 400 });
  }

  const validScopes = ["global", "user"];
  const resolvedScope = validScopes.includes(scope) ? scope : "global";

  upsertToolPolicy({
    tool_name,
    mcp_id: mcp_id || null,
    requires_approval: requires_approval !== undefined ? (requires_approval ? 1 : 0) : 1,
    scope: resolvedScope,
  });

  return NextResponse.json({ success: true }, { status: 201 });
}
