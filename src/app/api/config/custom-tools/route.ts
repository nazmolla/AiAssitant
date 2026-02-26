/**
 * GET /api/config/custom-tools — List all custom tools
 * POST /api/config/custom-tools — Create a custom tool
 * PUT /api/config/custom-tools — Update a custom tool (enable/disable)
 * DELETE /api/config/custom-tools — Delete a custom tool
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import {
  listCustomTools,
  createCustomToolRecord,
  updateCustomToolEnabled,
  deleteCustomToolRecord,
  getCustomTool,
  upsertToolPolicy,
} from "@/lib/db/queries";
import { loadCustomToolsFromDb } from "@/lib/agent/custom-tools";

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const tools = listCustomTools();
  return NextResponse.json(tools);
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await req.json();
  const { name, description, inputSchema, implementation } = body;

  if (!name || !description || !inputSchema || !implementation) {
    return NextResponse.json({ error: "name, description, inputSchema, and implementation are required" }, { status: 400 });
  }

  // Sanitize name
  const safeName = name.replace(/^custom\./, "").replace(/[^a-z0-9_]/gi, "_").toLowerCase();
  const fullName = `custom.${safeName}`;

  // Check duplicate
  if (getCustomTool(fullName)) {
    return NextResponse.json({ error: `Tool "${fullName}" already exists` }, { status: 409 });
  }

  // Validate schema
  if (typeof inputSchema !== "object" || inputSchema.type !== "object") {
    return NextResponse.json({ error: "inputSchema must have type: 'object'" }, { status: 400 });
  }

  // Validate code compiles
  try {
    // eslint-disable-next-line no-new
    new Function("args", implementation);
  } catch (err: any) {
    return NextResponse.json({ error: `Syntax error in implementation: ${err.message}` }, { status: 400 });
  }

  const record = createCustomToolRecord({
    name: fullName,
    description,
    inputSchema: JSON.stringify(inputSchema),
    implementation,
  });

  // Seed a tool policy for the new custom tool
  upsertToolPolicy({
    tool_name: fullName,
    mcp_id: null,
    requires_approval: 0,
    is_proactive_enabled: 0,
  });

  // Reload cache
  loadCustomToolsFromDb();

  return NextResponse.json(record, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await req.json();
  const { name, enabled } = body;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }

  const existing = getCustomTool(name);
  if (!existing) {
    return NextResponse.json({ error: `Tool "${name}" not found` }, { status: 404 });
  }

  updateCustomToolEnabled(name, enabled);
  loadCustomToolsFromDb();

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await req.json();
  const { name } = body;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const existing = getCustomTool(name);
  if (!existing) {
    return NextResponse.json({ error: `Tool "${name}" not found` }, { status: 404 });
  }

  deleteCustomToolRecord(name);

  // Remove the tool policy
  try {
    const { getDb } = require("@/lib/db/connection");
    getDb().prepare("DELETE FROM tool_policies WHERE tool_name = ?").run(name);
  } catch { /* policy may not exist */ }

  loadCustomToolsFromDb();

  return NextResponse.json({ ok: true });
}
