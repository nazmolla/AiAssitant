import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { listThreadsPaginated, createThread, addLog } from "@/lib/db";
import { initializeDatabase } from "@/lib/db";

// Ensure DB is initialized
try {
  initializeDatabase();
  addLog({ level: "verbose", source: "api.threads", message: "Database initialized for threads route.", metadata: JSON.stringify({ pid: process.pid }) });
} catch (err) {
  addLog({
    level: "critical",
    source: "api.threads",
    message: "Failed to initialize database for threads route.",
    metadata: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
  });
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireUser();
    if ("error" in auth) return auth.error;

    const url = req.nextUrl;
    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 200);
    const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

    const result = listThreadsPaginated(auth.user.id, limit, offset);
    return NextResponse.json(result);
  } catch (err) {
    addLog({
      level: "error",
      source: "api.threads",
      message: "Failed to fetch threads.",
      metadata: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
    });
    return NextResponse.json({ error: "Failed to fetch threads." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser();
    if ("error" in auth) return auth.error;

    const body = await req.json();
    const thread = createThread(body.title, auth.user.id);
    addLog({
      level: "verbose",
      source: "api.threads",
      message: "Created new thread.",
      metadata: JSON.stringify({ userId: auth.user.id, threadId: thread.id }),
    });
    return NextResponse.json(thread, { status: 201 });
  } catch (err) {
    addLog({
      level: "error",
      source: "api.threads",
      message: "Failed to create thread.",
      metadata: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
    });
    return NextResponse.json({ error: "Failed to create thread." }, { status: 500 });
  }
}
