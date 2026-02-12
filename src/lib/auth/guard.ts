import { getServerSession } from "next-auth";
import { authOptions } from "./options";
import { NextResponse } from "next/server";

/**
 * Get the authenticated session. Returns null if unauthenticated.
 */
export async function getOwnerSession() {
  return getServerSession(authOptions);
}

/**
 * Guard: returns a 401 NextResponse if user is not the authenticated owner.
 */
export async function requireOwner() {
  const session = await getOwnerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null; // authorized
}
