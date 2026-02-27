import { NextRequest, NextResponse } from "next/server";

/**
 * Receives client-side error reports and logs them to stdout (journalctl).
 * No auth required — fires from the error boundary before session is available.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.error("[CLIENT ERROR]", JSON.stringify(body, null, 2));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
}
