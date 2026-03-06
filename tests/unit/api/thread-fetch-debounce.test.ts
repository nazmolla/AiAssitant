/**
 * Unit tests — Debounced thread fetch (PERF-18)
 *
 * Since ChatPanel can't be rendered in jest/jsdom (react-markdown is ESM-only),
 * we verify:
 *  1. Source code uses fetchThreadsDebounced instead of bare fetch("/api/threads")
 *  2. The debounce + dedup logic works correctly in isolation
 */

import fs from "fs";
import path from "path";

const chatPanelSrc = fs.readFileSync(
  path.join(__dirname, "../../../src/components/chat-panel.tsx"),
  "utf-8"
);

describe("Source code verification", () => {
  test("all thread list fetches go through fetchThreadsDebounced", () => {
    // The only bare fetch("/api/threads") should be inside fetchThreadsDebounced itself
    const bareMatches = [...chatPanelSrc.matchAll(/fetch\("\/api\/threads"\)/g)];
    expect(bareMatches.length).toBe(1); // one inside the debounced function

    // Should have multiple calls to fetchThreadsDebounced
    const debouncedCalls = [...chatPanelSrc.matchAll(/fetchThreadsDebounced\(/g)];
    expect(debouncedCalls.length).toBeGreaterThanOrEqual(4); // mount + approval-resolved + approval action + SSE done
  });

  test("debounce function deduplicates in-flight fetches", () => {
    expect(chatPanelSrc).toContain("threadFetchInFlightRef");
    expect(chatPanelSrc).toContain("if (threadFetchInFlightRef.current) return");
  });

  test("debounce timer is cleaned up on unmount", () => {
    expect(chatPanelSrc).toContain("clearTimeout(threadFetchTimerRef.current)");
  });

  test("mount fetch uses immediate mode", () => {
    expect(chatPanelSrc).toContain("fetchThreadsDebounced(true)");
  });
});

describe("Debounce + dedup logic (isolated)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function createDebouncedFetch() {
    const results: number[] = [];
    let callCount = 0;
    let inFlight: Promise<void> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function fetchThreadsDebounced(immediate = false) {
      if (timer) clearTimeout(timer);
      const doFetch = () => {
        if (inFlight) return;
        const id = ++callCount;
        const p = Promise.resolve()
          .then(() => results.push(id))
          .finally(() => { inFlight = null; });
        inFlight = p;
      };
      if (immediate) { doFetch(); return; }
      timer = setTimeout(doFetch, 400);
    }

    return { fetchThreadsDebounced, results, getCallCount: () => callCount };
  }

  test("immediate mode fires synchronously without delay", () => {
    const { fetchThreadsDebounced, getCallCount } = createDebouncedFetch();
    fetchThreadsDebounced(true);
    // Promise.resolve is microtask — flush it
    expect(getCallCount()).toBe(1);
  });

  test("debounced calls collapse into one within the window", async () => {
    const { fetchThreadsDebounced, results } = createDebouncedFetch();
    fetchThreadsDebounced();
    fetchThreadsDebounced();
    fetchThreadsDebounced();

    jest.advanceTimersByTime(400);
    // Flush microtasks
    await Promise.resolve();

    expect(results).toHaveLength(1);
  });

  test("calls separated by more than 400ms each produce separate fetches", async () => {
    const { fetchThreadsDebounced, results } = createDebouncedFetch();

    fetchThreadsDebounced();
    jest.advanceTimersByTime(400);
    // Flush .then() and .finally() microtasks
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    fetchThreadsDebounced();
    jest.advanceTimersByTime(400);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(results).toHaveLength(2);
  });

  test("in-flight dedup prevents concurrent requests", async () => {
    let callCount = 0;
    let resolveInFlight: (() => void) | null = null;
    let inFlight: Promise<void> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function fetchThreadsDebounced(immediate = false) {
      if (timer) clearTimeout(timer);
      const doFetch = () => {
        if (inFlight) return; // dedup
        callCount++;
        const p = new Promise<void>((resolve) => { resolveInFlight = resolve; })
          .finally(() => { inFlight = null; });
        inFlight = p;
      };
      if (immediate) { doFetch(); return; }
      timer = setTimeout(doFetch, 400);
    }

    fetchThreadsDebounced(true); // starts first fetch
    expect(callCount).toBe(1);

    // While in-flight, another immediate call is skipped
    fetchThreadsDebounced(true);
    expect(callCount).toBe(1);

    // Resolve in-flight, then next call goes through
    resolveInFlight!();
    await Promise.resolve();
    fetchThreadsDebounced(true);
    expect(callCount).toBe(2);
  });

  test("rapid events followed by settle produce exactly one fetch", async () => {
    const { fetchThreadsDebounced, results } = createDebouncedFetch();

    // Simulate rapid events: SSE done, approval-resolved, approval action
    for (let i = 0; i < 10; i++) {
      fetchThreadsDebounced();
    }

    jest.advanceTimersByTime(400);
    await Promise.resolve();

    expect(results).toHaveLength(1);
  });

  test("timer cleanup prevents stale fetch after unmount", () => {
    const { fetchThreadsDebounced, results } = createDebouncedFetch();
    let timer: ReturnType<typeof setTimeout> | null = null;

    // Simulate the component pattern: schedule then cleanup
    const originalSetTimeout = globalThis.setTimeout;
    const timerIds: ReturnType<typeof setTimeout>[] = [];
    // Track timers
    fetchThreadsDebounced(); // schedules a timer

    // Simulate unmount cleanup
    // In real code: clearTimeout(threadFetchTimerRef.current)
    jest.clearAllTimers();

    // Advance time — fetch should NOT fire
    jest.advanceTimersByTime(1000);
    expect(results).toHaveLength(0);
  });
});
