import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { runAgentLoop } from "@/lib/agent";
import { getThread } from "@/lib/db";

export async function POST(
  req: NextRequest,
  { params }: { params: { threadId: string } }
) {
  const denied = await requireOwner();
  if (denied) return denied;

  const thread = getThread(params.threadId);
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  if (thread.status === "awaiting_approval") {
    return NextResponse.json(
      { error: "Thread is awaiting approval. Resolve pending actions first." },
      { status: 409 }
    );
  }

  const body = await req.json();
  const { message } = body;

  if (!message || typeof message !== "string") {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  try {
    const response = await runAgentLoop(params.threadId, message);
    return NextResponse.json(response);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
