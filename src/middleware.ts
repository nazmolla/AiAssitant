import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Rate-limiter: simple sliding-window counter per IP.
 * Limits each IP to MAX_REQUESTS within WINDOW_MS.
 */
const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 120; // 120 req/min per IP
const ipHits = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now > entry.resetAt) {
    ipHits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > MAX_REQUESTS;
}

// Periodically clean stale entries (every 5 min)
setInterval(() => {
  const now = Date.now();
  ipHits.forEach((entry, ip) => {
    if (now > entry.resetAt) ipHits.delete(ip);
  });
}, 300_000);

const authMiddleware = withAuth({
  callbacks: {
    authorized: ({ token }) => {
      if (!token) return false;
      // Multi-user: any authenticated user with a userId is allowed
      const userId = (token as Record<string, unknown>).userId;
      return !!userId;
    },
  },
});

export async function middleware(req: NextRequest) {
  // --- Rate limiting (applied to all matched routes) ---
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.ip || "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  // --- API-key bearer tokens bypass NextAuth session middleware ---
  // Requests carrying `Authorization: Bearer nxk_...` are validated later
  // in the route-level guards (guard.ts) — let them through here.
  const authHeader = req.headers.get("authorization") ?? "";
  const isApiKeyRequest = authHeader.toLowerCase().startsWith("bearer nxk_");

  if (isApiKeyRequest) {
    // Skip NextAuth middleware entirely — the route guard will validate the key.
    return NextResponse.next();
  }

  // --- For API routes: return proper 401 JSON instead of sign-in page redirect ---
  const isApiRoute = req.nextUrl.pathname.startsWith("/api/");

  // Run the NextAuth middleware
  const response = await (authMiddleware as any)(req, {} as any);

  // If NextAuth wants to redirect (unauthenticated) and this is an API route,
  // return a JSON 401 instead of an HTML redirect.
  if (isApiRoute && response instanceof Response) {
    const status = response.status;
    const location = response.headers.get("location");
    // NextAuth returns 302 redirect to sign-in for unauthenticated requests
    if ((status === 302 || status === 307) && location) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/api/threads/:path*",
    "/api/approvals/:path*",
    "/api/knowledge/:path*",
    "/api/mcp/:path*",
    "/api/policies/:path*",
    "/api/logs/:path*",
    "/api/config/:path*",
    "/api/attachments/:path*",
    "/api/admin/:path*",
  ],
};
