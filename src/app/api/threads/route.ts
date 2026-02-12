import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { listThreads, createThread } from "@/lib/db";
import { initializeDatabase } from "@/lib/db";

// Ensure DB is initialized
try { initializeDatabase(); } catch {}

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;

  const threads = listThreads();
  return NextResponse.json(threads);
}

export async function POST(req: NextRequest) {
  const denied = await requireOwner();
  if (denied) return denied;

  const body = await req.json();
  const thread = createThread(body.title);
  return NextResponse.json(thread, { status: 201 });
}
