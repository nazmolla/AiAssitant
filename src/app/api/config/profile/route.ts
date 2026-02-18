import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { getUserProfile, upsertUserProfile } from "@/lib/db";

export async function GET() {
  try {
    const auth = await requireUser();
    if ("error" in auth) return auth.error;

    const profile = getUserProfile(auth.user.id);
    return NextResponse.json(profile ?? null);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await requireUser();
    if ("error" in auth) return auth.error;

    const body = await req.json();
    const updated = upsertUserProfile(auth.user.id, body);
    return NextResponse.json(updated);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
