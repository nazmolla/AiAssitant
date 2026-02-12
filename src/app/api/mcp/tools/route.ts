import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { getMcpManager } from "@/lib/mcp";

export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;

  const tools = getMcpManager().getAllTools();
  return NextResponse.json(tools);
}
