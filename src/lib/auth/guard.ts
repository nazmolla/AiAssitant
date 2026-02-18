import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "./options";
import { bootstrapRuntime } from "@/lib/bootstrap";

const runtimeReady = bootstrapRuntime();

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
}

/**
 * Get the authenticated session. Returns null if unauthenticated.
 */
export async function getOwnerSession() {
  await runtimeReady;
  return getServerSession(authOptions);
}

/**
 * Get the authenticated user from the session.
 * Returns the user object with id, email, and role.
 */
export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  await runtimeReady;
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  const user = session.user as Record<string, unknown>;
  const id = user.id as string | undefined;
  const email = user.email as string | undefined;
  const role = (user.role as string) || "user";
  if (!id || !email) return null;
  return { id, email, role };
}

/**
 * Guard: returns a 401 NextResponse if user is not authenticated.
 * Returns null if authorized.
 */
export async function requireOwner() {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null; // authorized
}

/**
 * Guard: returns 401 or 403, plus the authenticated user if authorized.
 * Use this in API routes that need the user's ID.
 */
export async function requireUser(): Promise<{ error: NextResponse } | { user: AuthenticatedUser }> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return { user };
}

/**
 * Guard: ensures the authenticated user is an admin.
 */
export async function requireAdmin(): Promise<{ error: NextResponse } | { user: AuthenticatedUser }> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (user.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}
