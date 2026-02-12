import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { getRecentLogs } from "@/lib/db";

export async function GET(req: NextRequest) {
  const denied = await requireOwner();
  if (denied) return denied;

  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get("limit") || "100");

  const logs = getRecentLogs(limit);
  return NextResponse.json(logs);
}
