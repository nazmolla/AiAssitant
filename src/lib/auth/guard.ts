import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { auth } from "./auth";
import { bootstrapRuntime } from "@/lib/bootstrap";
import {
  isUserEnabled,
  getUserById,
  getApiKeyByRawKey,
  touchApiKey,
} from "@/lib/db";
import type { ApiKeyScope } from "@/lib/db/queries";

const runtimeReady = bootstrapRuntime();

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
  /** Present when auth was via API key — contains the granted scopes */
  apiKeyScopes?: ApiKeyScope[];
}

/**
 * Get the authenticated session. Returns null if unauthenticated.
 */
export async function getOwnerSession() {
  await runtimeReady;
  return auth();
}

// ─── API Key resolution ──────────────────────────────────────
/**
 * Attempt to authenticate via `Authorization: Bearer nxk_...` header.
 * Returns the authenticated user or null.
 */
async function resolveApiKey(): Promise<AuthenticatedUser | null> {
  try {
    const h = await headers();
    const authHeader = h.get("authorization");
    if (!authHeader) return null;

    const parts = authHeader.trim().split(/\s+/);
    if (parts.length !== 2) return null;
    const [scheme, token] = parts;
    if (scheme?.toLowerCase() !== "bearer" || !token?.startsWith("nxk_")) return null;

    const keyRecord = getApiKeyByRawKey(token);
    if (!keyRecord) return null;

    // Check expiry
    if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) return null;

    // Resolve the owning user
    const dbUser = getUserById(keyRecord.user_id);
    if (!dbUser) return null;
    if (!isUserEnabled(keyRecord.user_id)) return null;

    // Touch last-used timestamp (fire-and-forget)
    touchApiKey(keyRecord.id);

    const scopes: ApiKeyScope[] = JSON.parse(keyRecord.scopes);
    return {
      id: dbUser.id,
      email: dbUser.email,
      role: dbUser.role ?? "user",
      apiKeyScopes: scopes,
    };
  } catch {
    return null;
  }
}

/**
 * Get the authenticated user from the session OR an API key bearer token.
 * Session auth is checked first; if absent, the Authorization header is tried.
 */
export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  await runtimeReady;

  // 1. Try session-based auth (cookies)
  const session = await auth();
  if (session?.user) {
    const user = session.user as Record<string, unknown>;
    const id = user.id as string | undefined;
    const email = user.email as string | undefined;
    const role = (user.role as string) || "user";
    if (id && email) return { id, email, role };
  }

  // 2. Fall through to API key bearer token
  return resolveApiKey();
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
 * Also rejects inactive/disabled users with 403.
 */
export async function requireUser(): Promise<{ error: NextResponse } | { user: AuthenticatedUser }> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  // Belt-and-suspenders: block inactive users even if JWT callback didn't catch it
  if (!isUserEnabled(user.id)) {
    return { error: NextResponse.json({ error: "Account inactive. Contact an admin to activate your account." }, { status: 403 }) };
  }
  return { user };
}

/**
 * Guard: ensures the authenticated user has a specific API key scope
 * (only relevant for API-key-based requests — session users pass through).
 */
export async function requireScope(scope: ApiKeyScope): Promise<{ error: NextResponse } | { user: AuthenticatedUser }> {
  const result = await requireUser();
  if ("error" in result) return result;
  const { user } = result;

  // Session-based users are not scope-restricted
  if (!user.apiKeyScopes) return { user };

  if (!user.apiKeyScopes.includes(scope)) {
    return {
      error: NextResponse.json(
        { error: `API key missing required scope: ${scope}` },
        { status: 403 }
      ),
    };
  }
  return { user };
}

/**
 * Guard: ensures the authenticated user is an admin.
 * Admin routes ALWAYS require a session — API keys cannot be used
 * to perform administrative actions (user management, auth config, etc.).
 */
export async function requireAdmin(): Promise<{ error: NextResponse } | { user: AuthenticatedUser }> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  // Block API-key-based access to admin endpoints
  if (user.apiKeyScopes) {
    return { error: NextResponse.json({ error: "Admin endpoints require session authentication, not API keys." }, { status: 403 }) };
  }
  if (user.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user };
}
