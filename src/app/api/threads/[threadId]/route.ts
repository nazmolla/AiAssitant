import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { getThread, getThreadMessages } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: { threadId: string } }
) {
  const denied = await requireOwner();
  if (denied) return denied;

  const thread = getThread(params.threadId);
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const messages = getThreadMessages(params.threadId);
  return NextResponse.json({ thread, messages });
}
