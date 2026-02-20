import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { getMcpManager } from "@/lib/mcp";

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const tools = getMcpManager().getAllTools();
  return NextResponse.json(tools);
}
