import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "./options";
import { bootstrapRuntime } from "@/lib/bootstrap";

const runtimeReady = bootstrapRuntime();

/**
 * Get the authenticated session. Returns null if unauthenticated.
 */
export async function getOwnerSession() {
  await runtimeReady;
  return getServerSession(authOptions);
}

/**
 * Guard: returns a 401 NextResponse if user is not the authenticated owner.
 */
export async function requireOwner() {
  await runtimeReady;
  const session = await getOwnerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null; // authorized
}
