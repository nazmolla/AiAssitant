import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { discoverAllTools } from "@/lib/agent/discovery";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("api.mcp.tools");

export async function GET() {
  const t0 = Date.now();
  log.enter("GET /api/mcp/tools");
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const tools = discoverAllTools();
  log.exit("GET /api/mcp/tools", { count: tools.length }, Date.now() - t0);
  return NextResponse.json(tools);
}
