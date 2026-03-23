import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guard";
import { getDb } from "@/lib/db/connection";

export async function GET(): Promise<NextResponse> {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const db = getDb();
  // Extract tool name from message like: Tool "builtin.web_search" executed
  const rows = db.prepare(`
    SELECT
      substr(message, instr(message, '"')+1, instr(substr(message, instr(message, '"')+1), '"')-1) as tool_name,
      COUNT(*) as call_count,
      SUM(CASE WHEN message LIKE '%executed successfully%' THEN 1 ELSE 0 END) as success_count,
      SUM(CASE WHEN message LIKE '%failed%' OR message LIKE '%error%' THEN 1 ELSE 0 END) as error_count,
      MAX(created_at) as last_used
    FROM agent_logs
    WHERE source = 'agent'
      AND (message LIKE 'Tool "%executed%' OR message LIKE 'Tool "%failed%')
    GROUP BY tool_name
    ORDER BY call_count DESC
    LIMIT 100
  `).all();

  return NextResponse.json({ data: rows });
}
