/**
 * Unit tests — Dashboard Session Analytics
 *
 * Tests the extractSessionKey logic and ensures that logs without session IDs
 * are NOT counted as individual sessions (the bug that inflated session counts).
 */

// Replicate the extractSessionKey function from agent-dashboard.tsx
function extractSessionKey(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    const candidateKeys = ["sessionId", "session_id", "threadId", "thread_id", "conversationId", "conversation_id", "chatId", "chat_id", "run_id"];
    for (const key of candidateKeys) {
      const val = obj[key];
      if (typeof val === "string" && val.trim()) return val;
      if (typeof val === "number") return String(val);
    }
    return null;
  } catch {
    return null;
  }
}

interface MockLog {
  id: number;
  metadata: string | null;
}

/**
 * Simulate the session grouping logic from agent-dashboard.tsx.
 * Fixed version: only groups logs that have actual session IDs.
 */
function countSessions(logs: MockLog[]): number {
  const sessionsMap = new Map<string, MockLog[]>();
  for (const log of logs) {
    const sessionId = extractSessionKey(log.metadata);
    // Only group logs that have an actual session identifier
    if (!sessionId) continue;
    const existing = sessionsMap.get(sessionId);
    if (existing) existing.push(log);
    else sessionsMap.set(sessionId, [log]);
  }
  return sessionsMap.size;
}

describe("extractSessionKey", () => {
  test("returns null for null metadata", () => {
    expect(extractSessionKey(null)).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(extractSessionKey("")).toBeNull();
  });

  test("returns null for invalid JSON", () => {
    expect(extractSessionKey("not-json")).toBeNull();
  });

  test("returns null for JSON without session keys", () => {
    expect(extractSessionKey(JSON.stringify({ foo: "bar" }))).toBeNull();
  });

  test("extracts sessionId", () => {
    expect(extractSessionKey(JSON.stringify({ sessionId: "abc-123" }))).toBe("abc-123");
  });

  test("extracts thread_id", () => {
    expect(extractSessionKey(JSON.stringify({ thread_id: "thread-456" }))).toBe("thread-456");
  });

  test("extracts conversationId", () => {
    expect(extractSessionKey(JSON.stringify({ conversationId: "conv-789" }))).toBe("conv-789");
  });

  test("handles numeric session IDs", () => {
    expect(extractSessionKey(JSON.stringify({ sessionId: 42 }))).toBe("42");
  });

  test("returns null for array metadata", () => {
    expect(extractSessionKey(JSON.stringify([1, 2, 3]))).toBeNull();
  });

  test("ignores empty string session IDs", () => {
    expect(extractSessionKey(JSON.stringify({ sessionId: "  " }))).toBeNull();
  });
});

describe("Session counting (fixed)", () => {
  test("logs without session IDs are NOT counted as sessions", () => {
    const logs: MockLog[] = [
      { id: 1, metadata: null },
      { id: 2, metadata: JSON.stringify({ level: "verbose" }) },
      { id: 3, metadata: null },
      { id: 4, metadata: JSON.stringify({ some: "data" }) },
      { id: 5, metadata: null },
    ];
    // None of these logs have session identifiers — session count should be 0
    expect(countSessions(logs)).toBe(0);
  });

  test("only logs with session IDs are counted", () => {
    const logs: MockLog[] = [
      { id: 1, metadata: null },
      { id: 2, metadata: JSON.stringify({ sessionId: "sess-1" }) },
      { id: 3, metadata: null },
      { id: 4, metadata: JSON.stringify({ sessionId: "sess-1" }) },
      { id: 5, metadata: JSON.stringify({ sessionId: "sess-2" }) },
      { id: 6, metadata: null },
    ];
    // Only 2 unique sessions (sess-1 and sess-2), despite 6 total logs
    expect(countSessions(logs)).toBe(2);
  });

  test("multiple log entries with same session ID count as one session", () => {
    const logs: MockLog[] = Array.from({ length: 100 }, (_, i) => ({
      id: i,
      metadata: JSON.stringify({ thread_id: "single-thread" }),
    }));
    expect(countSessions(logs)).toBe(1);
  });

  test("mixed session keys from different candidate fields", () => {
    const logs: MockLog[] = [
      { id: 1, metadata: JSON.stringify({ sessionId: "a" }) },
      { id: 2, metadata: JSON.stringify({ thread_id: "b" }) },
      { id: 3, metadata: JSON.stringify({ conversationId: "c" }) },
      { id: 4, metadata: JSON.stringify({ chatId: "d" }) },
    ];
    expect(countSessions(logs)).toBe(4);
  });

  test("large number of sessionless logs does NOT inflate count", () => {
    // This was the original bug: 15270 logs without session IDs → 15270 "sessions"
    const logs: MockLog[] = Array.from({ length: 15270 }, (_, i) => ({
      id: i,
      metadata: JSON.stringify({ userId: "user-1", source: "api" }),
    }));
    expect(countSessions(logs)).toBe(0);
  });
});
