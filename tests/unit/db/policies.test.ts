/**
 * Unit tests — Tool Policies & Approval Queue
 */
import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import {
  upsertToolPolicy,
  getToolPolicy,
  listToolPolicies,
  createApprovalRequest,
  listPendingApprovals,
  updateApprovalStatus,
  createThread,
} from "@/lib/db/queries";

let userId: string;

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "policies@example.com" });
});
afterAll(() => teardownTestDb());

describe("Tool Policies", () => {
  test("upsertToolPolicy creates a new policy", () => {
    upsertToolPolicy({
      tool_name: "web_search",
      mcp_id: null,
      requires_approval: 0,
      is_proactive_enabled: 0,
    });
    const policy = getToolPolicy("web_search");
    expect(policy).toBeDefined();
    expect(policy!.requires_approval).toBe(0);
  });

  test("upsertToolPolicy updates existing policy", () => {
    upsertToolPolicy({
      tool_name: "web_search",
      mcp_id: null,
      requires_approval: 1,
      is_proactive_enabled: 1,
    });
    const policy = getToolPolicy("web_search");
    expect(policy!.requires_approval).toBe(1);
    expect(policy!.is_proactive_enabled).toBe(1);
  });

  test("getToolPolicy returns undefined for unknown tool", () => {
    expect(getToolPolicy("nonexistent_tool")).toBeUndefined();
  });

  test("listToolPolicies returns all policies", () => {
    upsertToolPolicy({
      tool_name: "file_write",
      mcp_id: null,
      requires_approval: 1,
      is_proactive_enabled: 0,
    });
    const policies = listToolPolicies();
    expect(policies.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Approval Queue", () => {
  let threadId: string;

  beforeAll(() => {
    const thread = createThread("Approval Thread", userId);
    threadId = thread.id;
  });

  test("createApprovalRequest creates a pending request", () => {
    const req = createApprovalRequest({
      thread_id: threadId,
      tool_name: "file_write",
      args: JSON.stringify({ path: "/tmp/test.txt" }),
      reasoning: "User asked to create a file",
    });
    expect(req.id).toBeDefined();
    expect(req.status).toBe("pending");
    expect(req.tool_name).toBe("file_write");
  });

  test("listPendingApprovals returns pending requests", () => {
    const pending = listPendingApprovals();
    expect(pending.length).toBeGreaterThan(0);
    expect(pending.every((r) => r.status === "pending")).toBe(true);
  });

  test("updateApprovalStatus approves a request", () => {
    const pending = listPendingApprovals();
    const req = pending[0];
    updateApprovalStatus(req.id, "approved");
    // Should no longer appear in pending
    const updatedPending = listPendingApprovals();
    expect(updatedPending.find((r) => r.id === req.id)).toBeUndefined();
  });

  test("updateApprovalStatus rejects a request", () => {
    const req = createApprovalRequest({
      thread_id: threadId,
      tool_name: "shell_exec",
      args: "{}",
      reasoning: null,
    });
    updateApprovalStatus(req.id, "rejected");
    const pending = listPendingApprovals();
    expect(pending.find((r) => r.id === req.id)).toBeUndefined();
  });
});
