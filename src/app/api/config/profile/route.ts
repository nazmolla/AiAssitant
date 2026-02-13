import { NextResponse } from "next/server";
import { getOwnerProfile, upsertOwnerProfile } from "@/lib/db";

export async function GET() {
  try {
    const profile = getOwnerProfile();
    return NextResponse.json(profile ?? null);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const updated = upsertOwnerProfile(body);
    return NextResponse.json(updated);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
