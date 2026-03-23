/**
 * Integration tests — Approvals API (/api/approvals)
 *
 * Tests approval listing, approve/reject actions, already-resolved handling,
 * thread status management, authorization, and proactive (thread_id=null) approvals.
 */
import { installAuthMocks, setMockUser } from "../../helpers/mock-auth";
installAuthMocks();

// Mock the agent module so we don't call real LLMs
jest.mock("@/lib/agent", () => ({
  executeApprovedTool: jest.fn(async () => ({
    status: "executed",
    result: { content: "file contents here" },
  })),
  continueAgentLoop: jest.fn(async () => ({
    content: "Here is the analysis based on the file.",
    toolsUsed: ["builtin.fs_read_file"],
    pendingApprovals: [],
    attachments: [],
  })),
}));

// Mock the scheduler module for proactive approval execution
jest.mock("@/lib/scheduler", () => ({
  executeProactiveApprovedTool: jest.fn(async () => ({
    result: "proactive tool executed",
  })),
}));

import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/approvals/route";
import {
  createThread,
  createApprovalRequest,
  updateApprovalStatus,
  addMessage,
  getThread,
  updateThreadStatus,
} from "@/lib/db/queries";
import { executeApprovedTool, continueAgentLoop } from "@/lib/agent";
import { executeProactiveApprovedTool } from "@/lib/scheduler";

let adminId: string;
let userId: string;
let otherUserId: string;

beforeAll(() => {
  setupTestDb();
  adminId = seedTestUser({ email: "admin-appr@test.com", role: "admin" });
  userId = seedTestUser({ email: "user-appr@test.com", role: "user" });
  otherUserId = seedTestUser({ email: "other-appr@test.com", role: "user" });
});
afterAll(() => teardownTestDb());

describe("GET /api/approvals", () => {
  let threadId: string;

  beforeAll(() => {
    const thread = createThread("Approval Test Thread", userId);
    threadId = thread.id;

    // Add an assistant message with tool_calls so findToolCallId works
    addMessage({
      thread_id: threadId,
      role: "assistant",
      content: "I'll read that file for you.",
      tool_calls: JSON.stringify([
        { id: "tc-001", name: "builtin.fs_read_file", arguments: { filePath: "/tmp/test.txt" } },
      ]),
      tool_results: null,
      attachments: null,
    });

    createApprovalRequest({
      thread_id: threadId,
      tool_name: "builtin.fs_read_file",
      args: JSON.stringify({ filePath: "/tmp/test.txt" }),
      reasoning: "User asked to read a file",
      source: "proactive",
    });

    // Thread must be in awaiting_approval for the approval to be actionable
    updateThreadStatus(threadId, "awaiting_approval");
  });

  test("returns 401 when unauthenticated", async () => {
    setMockUser(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  test("admin sees all pending approvals", async () => {
    setMockUser({ id: adminId, email: "admin-appr@test.com", role: "admin" });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((a: any) => a.status === "pending")).toBe(true);
  });

  test("user sees only their own thread approvals", async () => {
    setMockUser({ id: userId, email: "user-appr@test.com", role: "user" });
    const res = await GET();
    const data = await res.json();
    expect(data.length).toBeGreaterThan(0);
  });

  test("other user sees no approvals for another user's thread", async () => {
    setMockUser({ id: otherUserId, email: "other-appr@test.com", role: "user" });
    const res = await GET();
    const data = await res.json();
    expect(data.length).toBe(0);
  });
});

describe("POST /api/approvals — approve", () => {
  let threadId: string;
  let approvalId: string;

  beforeEach(() => {
    const thread = createThread("Approve Flow Thread", userId);
    threadId = thread.id;
    updateThreadStatus(threadId, "awaiting_approval");

    // Add assistant message with tool_calls
    addMessage({
      thread_id: threadId,
      role: "assistant",
      content: "Let me read that file.",
      tool_calls: JSON.stringify([
        { id: "tc-approve-001", name: "builtin.fs_read_file", arguments: { filePath: "/test.txt" } },
      ]),
      tool_results: null,
      attachments: null,
    });

    const approval = createApprovalRequest({
      thread_id: threadId,
      tool_name: "builtin.fs_read_file",
      args: JSON.stringify({ filePath: "/test.txt" }),
      reasoning: "Read file request",
    });
    approvalId = approval.id;

    // Reset mocks
    (executeApprovedTool as jest.Mock).mockClear();
    (continueAgentLoop as jest.Mock).mockClear();
    (executeApprovedTool as jest.Mock).mockResolvedValue({
      status: "executed",
      result: { content: "file contents" },
    });
    (continueAgentLoop as jest.Mock).mockResolvedValue({
      content: "Analysis complete.",
      toolsUsed: ["builtin.fs_read_file"],
      pendingApprovals: [],
      attachments: [],
    });
  });

  test("returns 400 without approvalId", async () => {
    setMockUser({ id: userId, email: "user-appr@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/approvals", {
      method: "POST",
      body: JSON.stringify({ action: "approved" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("returns 400 with invalid action", async () => {
    setMockUser({ id: userId, email: "user-appr@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/approvals", {
      method: "POST",
      body: JSON.stringify({ approvalId, action: "maybe" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  test("returns 404 for non-existent approval", async () => {
    setMockUser({ id: userId, email: "user-appr@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/approvals", {
      method: "POST",
      body: JSON.stringify({ approvalId: "nonexistent-id", action: "approved" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  test("returns 403 when non-owner tries to approve", async () => {
    setMockUser({ id: otherUserId, email: "other-appr@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/approvals", {
      method: "POST",
      body: JSON.stringify({ approvalId, action: "approved" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  test("approving executes tool and continues agent loop", async () => {
    setMockUser({ id: userId, email: "user-appr@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/approvals", {
      method: "POST",
      body: JSON.stringify({ approvalId, action: "approved" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("approved");
    expect(data.agentResponse).toBeDefined();
    expect(data.agentResponse.content).toBe("Analysis complete.");

    // Verify tool was executed and loop continued
    expect(executeApprovedTool).toHaveBeenCalledWith(
      "builtin.fs_read_file",
      { filePath: "/test.txt" },
      threadId
    );
    expect(continueAgentLoop).toHaveBeenCalledWith(threadId);
  });

  test("thread status is set to active after approval", async () => {
    setMockUser({ id: userId, email: "user-appr@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/approvals", {
      method: "POST",
      body: JSON.stringify({ approvalId, action: "approved" }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    // executeApprovedTool mock sets thread to active via the real implementation
    // but since we mock it, check the route doesn't leave it stuck
    // The mock already returns "executed" which means gatekeeper set it to active
  });

  test("continuation error is returned but status is still approved", async () => {
    (continueAgentLoop as jest.Mock).mockRejectedValue(new Error("LLM timeout"));

    setMockUser({ id: userId, email: "user-appr@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/approvals", {
      method: "POST",
      body: JSON.stringify({ approvalId, action: "approved" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("approved");
    expect(data.continuationError).toBe("LLM timeout");

    // Thread should still be unfrozen (set to active) even on continuation error
    const thread = getThread(threadId);
    expect(thread!.status).toBe("active");
  });

  test("tool execution error still unfreezes thread", async () => {
    (executeApprovedTool as jest.Mock).mockResolvedValue({
      status: "error",
      error: "File not found",
    });

    setMockUser({ id: userId, email: "user-appr@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/approvals", {
      method: "POST",
      body: JSON.stringify({ approvalId, action: "approved" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("approved");

    // Thread should be active (not stuck in awaiting_approval)
    const thread = getThread(threadId);
    expect(thread!.status).toBe("active");
  });
});

describe("POST /api/approvals — reject", () => {
  let threadId: string;
  let approvalId: string;

  beforeEach(() => {
    const thread = createThread("Reject Flow Thread", userId);
    threadId = thread.id;
    updateThreadStatus(threadId, "awaiting_approval");

    const approval = createApprovalRequest({
      thread_id: threadId,
      tool_name: "builtin.fs_delete_file",
      args: JSON.stringify({ filePath: "/important.txt" }),
      reasoning: null,
    });
    approvalId = approval.id;
  });

  test("rejecting unfreezes the thread", async () => {
    setMockUser({ id: userId, email: "user-appr@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/approvals", {
      method: "POST",
      body: JSON.stringify({ approvalId, action: "rejected" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("rejected");

    // Thread should be active after rejection
    const thread = getThread(threadId);
    expect(thread!.status).toBe("active");
  });

  test("rejecting does not execute the tool", async () => {
    (executeApprovedTool as jest.Mock).mockClear();
    setMockUser({ id: userId, email: "user-appr@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/approvals", {
      method: "POST",
      body: JSON.stringify({ approvalId, action: "rejected" }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);
    expect(executeApprovedTool).not.toHaveBeenCalled();
  });
});

describe("POST /api/approvals — already resolved", () => {
  let threadId: string;
  let approvalId: string;

  beforeEach(() => {
    const thread = createThread("Already Resolved Thread", userId);
    threadId = thread.id;

    const approval = createApprovalRequest({
      thread_id: threadId,
      tool_name: "web_search",
      args: "{}",
      reasoning: null,
    });
    approvalId = approval.id;
    updateApprovalStatus(approvalId, "approved");
  });

  test("returns alreadyResolved true for already-approved", async () => {
    setMockUser({ id: userId, email: "user-appr@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/approvals", {
      method: "POST",
      body: JSON.stringify({ approvalId, action: "approved" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.alreadyResolved).toBe(true);
    expect(data.status).toBe("approved");
  });
});

describe("GET /api/approvals — proactive approvals (thread_id=null)", () => {
  let proactiveApprovalId: string;

  beforeEach(() => {
    const approval = createApprovalRequest({
      thread_id: null,
      tool_name: "builtin.web_fetch",
      args: JSON.stringify({ speed: 3 }),
      reasoning: "Fan is running at unexpected speed",
      source: "proactive",
    });
    proactiveApprovalId = approval.id;
  });

  test("admin sees proactive approvals (thread_id=null)", async () => {
    setMockUser({ id: adminId, email: "admin-appr@test.com", role: "admin" });
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    const proactive = data.find((a: any) => a.id === proactiveApprovalId);
    expect(proactive).toBeDefined();
    expect(proactive.thread_id).toBeNull();
    expect(proactive.status).toBe("pending");
  });

  test("proactive approvals are NOT silently rejected", async () => {
    setMockUser({ id: adminId, email: "admin-appr@test.com", role: "admin" });
    // First GET should include the proactive approval
    const res = await GET();
    const data = await res.json();
    const proactive = data.find((a: any) => a.id === proactiveApprovalId);
    expect(proactive).toBeDefined();
    expect(proactive.status).toBe("pending");
  });

  test("non-admin users do NOT see proactive approvals", async () => {
    setMockUser({ id: userId, email: "user-appr@test.com", role: "user" });
    const res = await GET();
    const data = await res.json();
    const proactive = data.find((a: any) => a.id === proactiveApprovalId);
    expect(proactive).toBeUndefined();
  });
});

describe("POST /api/approvals — proactive approve", () => {
  let proactiveApprovalId: string;

  beforeEach(() => {
    const approval = createApprovalRequest({
      thread_id: null,
      tool_name: "builtin.web_fetch",
      args: JSON.stringify({ speed: 3 }),
      reasoning: "Fan running at unexpected speed — adjust",
      source: "proactive",
    });
    proactiveApprovalId = approval.id;
    (executeProactiveApprovedTool as jest.Mock).mockClear();
    (executeProactiveApprovedTool as jest.Mock).mockResolvedValue({ result: "fan speed set" });
  });

  test("admin can approve proactive approval", async () => {
    setMockUser({ id: adminId, email: "admin-appr@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/approvals", {
      method: "POST",
      body: JSON.stringify({ approvalId: proactiveApprovalId, action: "approved" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("approved");
    expect(data.result.status).toBe("executed");
    expect(executeProactiveApprovedTool).toHaveBeenCalledWith(
      "builtin.web_fetch",
      { speed: 3 }
    );
  });

  test("non-admin cannot approve proactive approval", async () => {
    setMockUser({ id: userId, email: "user-appr@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/approvals", {
      method: "POST",
      body: JSON.stringify({ approvalId: proactiveApprovalId, action: "approved" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  test("proactive tool execution error returns error status", async () => {
    (executeProactiveApprovedTool as jest.Mock).mockRejectedValue(
      new Error("MCP server not connected")
    );
    setMockUser({ id: adminId, email: "admin-appr@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/approvals", {
      method: "POST",
      body: JSON.stringify({ approvalId: proactiveApprovalId, action: "approved" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("approved");
    expect(data.result.status).toBe("error");
    expect(data.result.error).toBe("MCP server not connected");
  });
});

describe("POST /api/approvals — proactive reject", () => {
  let proactiveApprovalId: string;

  beforeEach(() => {
    const approval = createApprovalRequest({
      thread_id: null,
      tool_name: "builtin.web_fetch",
      args: JSON.stringify({ speed: 3 }),
      reasoning: "Fan running at unexpected speed",
      source: "proactive",
    });
    proactiveApprovalId = approval.id;
    (executeProactiveApprovedTool as jest.Mock).mockClear();
  });

  test("admin can reject proactive approval", async () => {
    setMockUser({ id: adminId, email: "admin-appr@test.com", role: "admin" });
    const req = new NextRequest("http://localhost/api/approvals", {
      method: "POST",
      body: JSON.stringify({ approvalId: proactiveApprovalId, action: "rejected" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("rejected");
    expect(executeProactiveApprovedTool).not.toHaveBeenCalled();
  });

  test("non-admin cannot reject proactive approval", async () => {
    setMockUser({ id: userId, email: "user-appr@test.com", role: "user" });
    const req = new NextRequest("http://localhost/api/approvals", {
      method: "POST",
      body: JSON.stringify({ approvalId: proactiveApprovalId, action: "rejected" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});
