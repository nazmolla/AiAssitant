import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { listThreads, createThread } from "@/lib/db";
import { initializeDatabase } from "@/lib/db";

// Ensure DB is initialized
try { initializeDatabase(); } catch {}

export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const threads = listThreads(auth.user.id);
  return NextResponse.json(threads);
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const body = await req.json();
  const thread = createThread(body.title, auth.user.id);
  return NextResponse.json(thread, { status: 201 });
}
