import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { getDb } from "@/lib/db/connection";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const { searchParams } = new URL(req.url);
  const toolName = searchParams.get("tool") ?? "";
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100"), 500);

  const db = getDb();
  const rows = db.prepare(`
    SELECT id, created_at, source, message, metadata
    FROM agent_logs
    WHERE source = 'agent'
      AND message LIKE '%Tool "%' ESCAPE '\\' ${toolName ? "AND message LIKE ?" : ""}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...(toolName ? [`%${toolName}%`, limit] : [limit]));

  return NextResponse.json({ data: rows });
}
