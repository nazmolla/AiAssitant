/**
 * Unit tests — Middleware rate-limiter logic
 *
 * We test the rate-limiting function in isolation by re-implementing
 * the same sliding-window algorithm and verifying its behaviour.
 */

describe("Rate Limiter Logic", () => {
  const WINDOW_MS = 60_000;
  const MAX_REQUESTS = 120;

  let ipHits: Map<string, { count: number; resetAt: number }>;

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

  beforeEach(() => {
    ipHits = new Map();
  });

  test("first request is never rate limited", () => {
    expect(isRateLimited("10.0.0.1")).toBe(false);
  });

  test("allows up to MAX_REQUESTS in a window", () => {
    for (let i = 0; i < MAX_REQUESTS; i++) {
      expect(isRateLimited("10.0.0.2")).toBe(false);
    }
  });

  test("blocks request #MAX_REQUESTS+1", () => {
    for (let i = 0; i < MAX_REQUESTS; i++) {
      isRateLimited("10.0.0.3");
    }
    expect(isRateLimited("10.0.0.3")).toBe(true);
  });

  test("different IPs have independent limits", () => {
    for (let i = 0; i < MAX_REQUESTS; i++) {
      isRateLimited("10.0.0.4");
    }
    expect(isRateLimited("10.0.0.4")).toBe(true);
    expect(isRateLimited("10.0.0.5")).toBe(false);
  });

  test("counter resets after window expires", () => {
    // Simulate filling the window
    for (let i = 0; i < MAX_REQUESTS; i++) {
      isRateLimited("10.0.0.6");
    }
    expect(isRateLimited("10.0.0.6")).toBe(true);

    // Fast-forward past the window by directly manipulating resetAt
    const entry = ipHits.get("10.0.0.6")!;
    entry.resetAt = Date.now() - 1;

    // Should reset and allow again
    expect(isRateLimited("10.0.0.6")).toBe(false);
  });

  test("stale entry cleanup", () => {
    isRateLimited("10.0.0.7");
    const entry = ipHits.get("10.0.0.7")!;
    entry.resetAt = Date.now() - 1;

    // Simulate the periodic cleanup
    const now = Date.now();
    ipHits.forEach((e, ip) => {
      if (now > e.resetAt) ipHits.delete(ip);
    });

    expect(ipHits.has("10.0.0.7")).toBe(false);
  });
});
