import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { listKnowledge, upsertKnowledge, updateKnowledge, deleteKnowledge, getKnowledgeEntry } from "@/lib/db";

export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const knowledge = listKnowledge(auth.user.id);
  return NextResponse.json(knowledge);
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const body = await req.json();
  const { entity, attribute, value, source_context } = body;

  if (!entity || !attribute || !value) {
    return NextResponse.json(
      { error: "entity, attribute, and value are required." },
      { status: 400 }
    );
  }

  upsertKnowledge(
    { user_id: auth.user.id, entity, attribute, value, source_context: source_context || null },
    auth.user.id
  );
  return NextResponse.json({ success: true }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const body = await req.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

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
