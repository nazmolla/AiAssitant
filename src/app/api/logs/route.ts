import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getRecentLogs } from "@/lib/db";

export async function GET(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const limitParam = (searchParams.get("limit") || "100").trim().toLowerCase();
  const limit = limitParam === "all"
    ? Number.NaN
    : Math.max(1, Math.min(Number.parseInt(limitParam, 10) || 100, 1000));

  const logs = getRecentLogs(limit);
  return NextResponse.json(logs);
}
