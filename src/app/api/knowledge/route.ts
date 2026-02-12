import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { listKnowledge, upsertKnowledge, updateKnowledge, deleteKnowledge } from "@/lib/db";

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;

  const knowledge = listKnowledge();
  return NextResponse.json(knowledge);
}

export async function POST(req: NextRequest) {
  const denied = await requireOwner();
  if (denied) return denied;

  const body = await req.json();
  const { entity, attribute, value, source_context } = body;

  if (!entity || !attribute || !value) {
    return NextResponse.json(
      { error: "entity, attribute, and value are required." },
      { status: 400 }
    );
  }

  upsertKnowledge({ entity, attribute, value, source_context: source_context || null });
  return NextResponse.json({ success: true }, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const denied = await requireOwner();
  if (denied) return denied;

  const body = await req.json();
  const { id, ...updates } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  updateKnowledge(id, updates);
  return NextResponse.json({ success: true });
}

export async function DELETE(req: NextRequest) {
  const denied = await requireOwner();
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  deleteKnowledge(Number(id));
  return NextResponse.json({ success: true });
}
