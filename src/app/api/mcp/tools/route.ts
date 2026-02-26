import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { discoverAllTools } from "@/lib/agent/discovery";

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  return NextResponse.json(discoverAllTools());
}
