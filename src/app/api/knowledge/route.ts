import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { listKnowledgePaginated, upsertKnowledge, updateKnowledge, deleteKnowledge, getKnowledgeEntry } from "@/lib/db";
import { validateBody } from "@/lib/validation";
import { updateKnowledgeSchema } from "@/lib/schemas";

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const url = req.nextUrl;
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 1), 500);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

  const result = listKnowledgePaginated(auth.user.id, limit, offset);
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const body = await req.json();
  const { entity, attribute, value, source_context, source_type } = body;

  if (!entity || !attribute || !value) {
    return NextResponse.json(
      { error: "entity, attribute, and value are required." },
      { status: 400 }
    );
  }

  upsertKnowledge(
    {
      user_id: auth.user.id,
      entity,
      attribute,
      value,
      source_type: source_type === "chat" || source_type === "proactive" ? source_type : "manual",
      source_context: source_context || null,
    },
    auth.user.id
  );
  return NextResponse.json({ success: true }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const body = await req.json();
  const validation = validateBody(body, updateKnowledgeSchema);
  if (!validation.success) return validation.response;

  const { id, ...updates } = validation.data;

  // Verify ownership
  const entry = getKnowledgeEntry(id);
  if (!entry || entry.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  updateKnowledge(id, updates);
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  // Verify ownership
  const entry = getKnowledgeEntry(Number(id));
  if (!entry || entry.user_id !== auth.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  deleteKnowledge(Number(id));
  return NextResponse.json({ success: true });
}
