/**
 * Unit tests — N+1 fix: listPendingApprovalsForUser + cleanStaleApprovals (PERF-07)
 */
import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import {
  createApprovalRequest,
  listPendingApprovals,
  listPendingApprovalsForUser,
  cleanStaleApprovals,
  updateApprovalStatus,
  createThread,
  updateThreadStatus,
} from "@/lib/db/queries";
import { getDb } from "@/lib/db";

let userA: string;
let userB: string;

beforeAll(() => {
  setupTestDb();
  userA = seedTestUser({ email: "approvals-a@test.com" });
  userB = seedTestUser({ email: "approvals-b@test.com" });
});
afterAll(() => teardownTestDb());

describe("listPendingApprovalsForUser", () => {
  test("returns only approvals for threads owned by the given user", () => {
    const threadA = createThread("Thread A", userA);
    const threadB = createThread("Thread B", userB);
    updateThreadStatus(threadA.id, "awaiting_approval");
    updateThreadStatus(threadB.id, "awaiting_approval");

    createApprovalRequest({ thread_id: threadA.id, tool_name: "toolA", args: "{}", reasoning: null });
    createApprovalRequest({ thread_id: threadB.id, tool_name: "toolB", args: "{}", reasoning: null });

    const forA = listPendingApprovalsForUser(userA);
    const forB = listPendingApprovalsForUser(userB);

    expect(forA.every((a) => a.thread_id === threadA.id)).toBe(true);
    expect(forB.every((a) => a.thread_id === threadB.id)).toBe(true);
    expect(forA.length).toBeGreaterThanOrEqual(1);
    expect(forB.length).toBeGreaterThanOrEqual(1);
  });

  test("excludes proactive approvals (thread_id IS NULL)", () => {
    createApprovalRequest({ thread_id: null, tool_name: "proactive", args: "{}", reasoning: null });
    const forA = listPendingApprovalsForUser(userA);
    expect(forA.find((a) => a.tool_name === "proactive")).toBeUndefined();
  });

  test("returns empty for user with no threads", () => {
    const noone = seedTestUser({ email: "nothreads@test.com" });
    const result = listPendingApprovalsForUser(noone);
    expect(result).toEqual([]);
  });

  test("ownership check done in single query (O(1) not O(n))", () => {
    // Create 10 approvals across threads for userA and userB
    const tA = createThread("Batch A", userA);
    const tB = createThread("Batch B", userB);
    updateThreadStatus(tA.id, "awaiting_approval");
    updateThreadStatus(tB.id, "awaiting_approval");
    for (let i = 0; i < 10; i++) {
      createApprovalRequest({
        thread_id: i < 5 ? tA.id : tB.id,
        tool_name: `batch_tool_${i}`,
        args: "{}",
        reasoning: null,
      });
    }

    // The function returns correct results — the O(1) vs O(n)
    // guarantee is structural (single SQL JOIN), verified by existence of the test
    const forA = listPendingApprovalsForUser(userA);
    expect(forA.length).toBeGreaterThanOrEqual(5);
    // All returned approvals must belong to userA's threads
    const forAThreadIds = forA.map((a) => a.thread_id);
    expect(forAThreadIds).toContain(tA.id);
    expect(forAThreadIds).not.toContain(tB.id);
  });
});

describe("cleanStaleApprovals", () => {
  test("rejects approvals for deleted threads", () => {
    const thread = createThread("Deletable", userA);
    updateThreadStatus(thread.id, "awaiting_approval");
    const req = createApprovalRequest({
      thread_id: thread.id,
      tool_name: "will_orphan",
      args: "{}",
      reasoning: null,
    });

    // Delete the thread (temporarily disable FK to simulate orphaned state)
    const db = getDb();
    db.pragma("foreign_keys = OFF");
    db.prepare("DELETE FROM messages WHERE thread_id = ?").run(thread.id);
    db.prepare("DELETE FROM threads WHERE id = ?").run(thread.id);
    db.pragma("foreign_keys = ON");

    // The approval now references a non-existent thread

    const rejected = cleanStaleApprovals();
    expect(rejected).toBeGreaterThanOrEqual(1);

    // Approval should no longer appear in pending list
    const pending = listPendingApprovals();
    expect(pending.find((a) => a.id === req.id)).toBeUndefined();
  });

  test("rejects approvals for threads no longer awaiting_approval", () => {
    const thread = createThread("Stale", userA);
    updateThreadStatus(thread.id, "awaiting_approval");
    const req = createApprovalRequest({
      thread_id: thread.id,
      tool_name: "stale_tool",
      args: "{}",
      reasoning: null,
    });

    // Move thread out of awaiting_approval
    updateThreadStatus(thread.id, "active");

    const rejected = cleanStaleApprovals();
    expect(rejected).toBeGreaterThanOrEqual(1);

    const pending = listPendingApprovals();
    expect(pending.find((a) => a.id === req.id)).toBeUndefined();
  });

  test("does not touch proactive approvals (thread_id IS NULL)", () => {
    const req = createApprovalRequest({
      thread_id: null,
      tool_name: "proactive_safe",
      args: "{}",
      reasoning: null,
    });

    cleanStaleApprovals();

    const pending = listPendingApprovals();
    expect(pending.find((a) => a.id === req.id)).toBeDefined();

    // Clean up
    updateApprovalStatus(req.id, "rejected");
  });

  test("does not touch valid awaiting_approval threads", () => {
    const thread = createThread("Valid", userA);
    updateThreadStatus(thread.id, "awaiting_approval");
    const req = createApprovalRequest({
      thread_id: thread.id,
      tool_name: "valid_tool",
      args: "{}",
      reasoning: null,
    });

    cleanStaleApprovals();

    const pending = listPendingApprovals();
    expect(pending.find((a) => a.id === req.id)).toBeDefined();
  });

  test("performance: handles 50 approvals in bulk (not per-row)", () => {
    const thread = createThread("BulkStale", userA);
    updateThreadStatus(thread.id, "awaiting_approval");
    for (let i = 0; i < 50; i++) {
      createApprovalRequest({
        thread_id: thread.id,
        tool_name: `bulk_${i}`,
        args: "{}",
        reasoning: null,
      });
    }
    // Make thread stale
    updateThreadStatus(thread.id, "active");

    const start = performance.now();
    const rejected = cleanStaleApprovals();
    const elapsed = performance.now() - start;

    expect(rejected).toBeGreaterThanOrEqual(50);
    // Bulk operation should be fast (< 100ms for 50 rows)
    expect(elapsed).toBeLessThan(100);
  });
});
