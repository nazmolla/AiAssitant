import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { listToolPolicies, upsertToolPolicy } from "@/lib/db";

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;

  const policies = listToolPolicies();
  return NextResponse.json(policies);
}

export async function POST(req: NextRequest) {
  const denied = await requireOwner();
  if (denied) return denied;

  const body = await req.json();
  const { tool_name, mcp_id, requires_approval, is_proactive_enabled } = body;

  if (!tool_name) {
    return NextResponse.json({ error: "tool_name is required." }, { status: 400 });
  }

  upsertToolPolicy({
    tool_name,
    mcp_id: mcp_id || null,
    requires_approval: requires_approval !== undefined ? (requires_approval ? 1 : 0) : 1,
    is_proactive_enabled: is_proactive_enabled ? 1 : 0,
  });

  return NextResponse.json({ success: true }, { status: 201 });
}
