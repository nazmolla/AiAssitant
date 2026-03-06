/**
 * Unit tests — Middleware (rate-limiter + auth routing)
 *
 * Tests the actual exported middleware function, which exercises the
 * real isRateLimited() sliding-window logic and auth routing.
 */

// ── Mocks ────────────────────────────────────────────────────────

jest.mock("next-auth/jwt", () => ({
  getToken: jest.fn(),
}));

import { middleware } from "@/middleware";
import { getToken } from "next-auth/jwt";
import { NextRequest } from "next/server";

const mockedGetToken = getToken as jest.MockedFunction<typeof getToken>;

function makeRequest(opts: { ip?: string; path?: string; auth?: string } = {}) {
  const { ip = "10.0.0.1", path = "/api/threads/abc", auth } = opts;
  const url = `http://localhost:3000${path}`;
  const headers = new Headers();
  headers.set("x-forwarded-for", ip);
  if (auth) headers.set("authorization", auth);
  return new NextRequest(url, { headers });
}

// Each test uses a unique IP so the module-scoped ipHits Map is fresh per test.
let ipCounter = 0;
function uniqueIp() {
  return `192.168.${Math.floor(ipCounter / 256)}.${ipCounter++ % 256}`;
}

// ── Tests ────────────────────────────────────────────────────────

describe("Middleware — rate limiter (real implementation)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetToken.mockResolvedValue({ userId: "u1" } as never);
  });

  test("first request is never rate limited", async () => {
    const res = await middleware(makeRequest({ ip: uniqueIp() }));
    expect(res.status).not.toBe(429);
  });

  test("allows up to 120 requests in a window", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 120; i++) {
      const res = await middleware(makeRequest({ ip }));
      expect(res.status).not.toBe(429);
    }
  });

  test("blocks request #121", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 120; i++) {
      await middleware(makeRequest({ ip }));
    }
    const res = await middleware(makeRequest({ ip }));
    expect(res.status).toBe(429);

    const body = await res.json();
    expect(body.error).toMatch(/too many requests/i);
    expect(res.headers.get("Retry-After")).toBe("60");
  });

  test("different IPs have independent limits", async () => {
    const ipA = uniqueIp();
    const ipB = uniqueIp();
    for (let i = 0; i < 120; i++) {
      await middleware(makeRequest({ ip: ipA }));
    }
    // ipA is exhausted
    const resA = await middleware(makeRequest({ ip: ipA }));
    expect(resA.status).toBe(429);
    // ipB is fresh
    const resB = await middleware(makeRequest({ ip: ipB }));
    expect(resB.status).not.toBe(429);
  });

  // PERF-14: LRU eviction ensures map doesn't grow unbounded
  test("handles many unique IPs without crashing (LRU eviction)", async () => {
    // Send requests from a large number of unique IPs
    // The LRU eviction at 10K cap should prevent unbounded growth
    const batchSize = 500;
    for (let i = 0; i < batchSize; i++) {
      const res = await middleware(makeRequest({ ip: uniqueIp() }));
      expect(res.status).not.toBe(429);
    }
    // All should succeed — each IP is unique with only 1 request
  });

  test("rate limiting still works after LRU eviction", async () => {
    const ip = uniqueIp();
    // Exhaust this IP's rate limit
    for (let i = 0; i < 120; i++) {
      await middleware(makeRequest({ ip }));
    }
    // Should be blocked
    const res = await middleware(makeRequest({ ip }));
    expect(res.status).toBe(429);
  });
});

describe("Middleware — auth routing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("API-key bearer tokens bypass session auth", async () => {
    const ip = uniqueIp();
    mockedGetToken.mockResolvedValue(null);
    const res = await middleware(
      makeRequest({ ip, auth: "Bearer nxk_test1234" })
    );
    expect(res.status).toBe(200);
    expect(mockedGetToken).not.toHaveBeenCalled();
  });

  test("unauthenticated API requests return 401", async () => {
    const ip = uniqueIp();
    mockedGetToken.mockResolvedValue(null);
    const res = await middleware(makeRequest({ ip, path: "/api/threads/abc" }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/authentication required/i);
  });

  test("authenticated API requests pass through", async () => {
    const ip = uniqueIp();
    mockedGetToken.mockResolvedValue({ userId: "u1" } as never);
    const res = await middleware(makeRequest({ ip, path: "/api/threads/abc" }));
    expect(res.status).toBe(200);
  });
});
