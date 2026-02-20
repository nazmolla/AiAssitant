import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getRecentLogs } from "@/lib/db";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") || "100"), 1000);

  const logs = getRecentLogs(limit);
  return NextResponse.json(logs);
}
