import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { listToolPolicies, upsertToolPolicy } from "@/lib/db";

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const policies = listToolPolicies();
  return NextResponse.json(policies);
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

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
