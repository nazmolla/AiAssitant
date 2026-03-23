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
  updateCustomToolRecord,
  deleteCustomToolRecord,
  getCustomTool,
  upsertToolPolicy,
} from "@/lib/db/queries";
import { loadCustomToolsFromDb, validateImplementation } from "@/lib/tools/custom-tools";
import { invalidateToolCache } from "@/lib/agent/loop-worker";
import { discoverAllTools } from "@/lib/agent/discovery";
import { findDuplicateToolMatch } from "@/lib/tools/tool-duplicate-gate";

export async function GET(): Promise<NextResponse> {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const tools = listCustomTools();
  return NextResponse.json(tools);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
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

  const duplicate = findDuplicateToolMatch(
    {
      name: fullName,
      description,
      inputSchema,
    },
    discoverAllTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  );
  if (duplicate) {
    return NextResponse.json(
      {
        error: `Tool is too similar to existing tool "${duplicate.toolName}" (score: ${duplicate.score.toFixed(2)}). Update the existing tool instead.`,
      },
      { status: 409 },
    );
  }

  // Validate schema
  if (typeof inputSchema !== "object" || inputSchema.type !== "object") {
    return NextResponse.json({ error: "inputSchema must have type: 'object'" }, { status: 400 });
  }

  // Validate code compiles and runs in sandbox
  const validationError = validateImplementation(implementation);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
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
    scope: "global",
  });

  // Reload cache
  loadCustomToolsFromDb();
  invalidateToolCache();

  return NextResponse.json(record, { status: 201 });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { name, enabled, description, inputSchema, implementation } = body;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const existing = getCustomTool(name);
  if (!existing) {
    return NextResponse.json({ error: `Tool "${name}" not found` }, { status: 404 });
  }

  // Simple toggle update
  if (typeof enabled === "boolean" && !description && !inputSchema && !implementation) {
    updateCustomToolEnabled(name, enabled);
    loadCustomToolsFromDb();
  invalidateToolCache();
    return NextResponse.json({ ok: true });
  }

  // Full field update
  const newDescription = typeof description === "string" ? description : existing.description;
  const newInputSchema = (inputSchema && typeof inputSchema === "object") ? inputSchema : JSON.parse(existing.input_schema);
  const newImplementation = typeof implementation === "string" ? implementation : existing.implementation;

  if (inputSchema && (typeof newInputSchema !== "object" || newInputSchema.type !== "object")) {
    return NextResponse.json({ error: "inputSchema must have type: 'object'" }, { status: 400 });
  }

  if (typeof implementation === "string") {
    const validationError = validateImplementation(newImplementation);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }
  }

  updateCustomToolRecord(name, {
    description: newDescription,
    inputSchema: JSON.stringify(newInputSchema),
    implementation: newImplementation,
  });

  if (typeof enabled === "boolean") {
    updateCustomToolEnabled(name, enabled);
  }

  loadCustomToolsFromDb();
  invalidateToolCache();
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
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
  invalidateToolCache();

  return NextResponse.json({ ok: true });
}
