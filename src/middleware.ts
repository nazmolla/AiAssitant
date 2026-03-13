import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_CACHE_SIZE,
} from "@/lib/constants";

/* ── Rate Limiting ────────────────────────────────────────────────── */

/**
 * Sliding-window counter per IP.
 * Returns a 429 response if the IP exceeds RATE_LIMIT_MAX_REQUESTS within RATE_LIMIT_WINDOW_MS.
 */
const ipHits = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = ipHits.get(ip);
  if (!entry || now > entry.resetAt) {
    if (ipHits.size >= RATE_LIMIT_CACHE_SIZE) {
      const firstKey = ipHits.keys().next().value;
      if (firstKey) ipHits.delete(firstKey);
    }
    ipHits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT_MAX_REQUESTS;
}

// Clean stale entries every 60s
setInterval(() => {
  const now = Date.now();
  ipHits.forEach((entry, ip) => {
    if (now > entry.resetAt) ipHits.delete(ip);
  });
}, RATE_LIMIT_WINDOW_MS);

export function applyRateLimit(req: NextRequest): NextResponse | null {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
  return null;
}

/* ── Auth Bypass ──────────────────────────────────────────────────── */

const WEBHOOK_PATTERN = /^\/api\/channels\/[^/]+\/webhook\/?$/;

/**
 * Checks whether the request should bypass session auth.
 * Returns `NextResponse.next()` for API-key bearer tokens and webhook routes,
 * or `null` if normal auth gating should proceed.
 */
export function checkAuthBypass(req: NextRequest): NextResponse | null {
  // API-key bearer tokens — validated later in route-level guards (guard.ts)
  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader.toLowerCase().startsWith("bearer nxk_")) {
    return NextResponse.next();
  }

  // Inbound channel webhooks use their own secret-based auth
  if (WEBHOOK_PATTERN.test(req.nextUrl.pathname)) {
    return NextResponse.next();
  }

  return null;
}

/* ── Auth Gating ──────────────────────────────────────────────────── */

/**
 * Verifies the JWT session token. Returns 401 for API routes or
 * redirects to signin for page routes when unauthenticated.
 */
export async function gateAuth(req: NextRequest): Promise<NextResponse | null> {
  const isApiRoute = req.nextUrl.pathname.startsWith("/api/");
  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
  const userId = (token as Record<string, unknown> | null)?.userId;

  if (!token || !userId) {
    if (isApiRoute) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
    return NextResponse.redirect(new URL("/auth/signin", req.url));
  }

  return null;
}

/* ── Composed Middleware Pipeline ──────────────────────────────────── */

export async function middleware(req: NextRequest) {
  // 1. Rate limiting — applied to all matched routes
  const rateLimitResponse = applyRateLimit(req);
  if (rateLimitResponse) return rateLimitResponse;

  // 2. Auth bypass — API keys and webhooks skip session auth
  const bypassResponse = checkAuthBypass(req);
  if (bypassResponse) return bypassResponse;

  // 3. Auth gating — verify JWT session
  const authResponse = await gateAuth(req);
  if (authResponse) return authResponse;

  return NextResponse.next();
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
    "/api/audio/:path*",
    "/api/conversation/:path*",
    "/api/notifications",
    "/api/channels/:path*",
  ],
};
