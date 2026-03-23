/**
 * Unit tests — Gatekeeper tool policy enforcement
 *
 * Validates that:
 * - MCP tools with no policy require approval (default-deny)
 * - MCP tools with requires_approval=1 request approval
 * - MCP tools with requires_approval=0 auto-execute
 * - Built-in FS destructive tools are seeded with requires_approval=1
 * - Built-in network sensitive tools are seeded with requires_approval=1
 */
import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import {
  upsertToolPolicy,
  getToolPolicy,
  listToolPolicies,
  createThread,
} from "@/lib/db/queries";
import { FS_TOOLS_REQUIRING_APPROVAL } from "@/lib/tools/fs-tools";
import { NETWORK_TOOLS_REQUIRING_APPROVAL } from "@/lib/tools/network-tools";
import { COMMUNICATION_TOOLS_REQUIRING_APPROVAL } from "@/lib/tools/communication-tools";

// Mock tool registry so executeToolWithPolicy can dispatch tools
jest.mock("@/lib/agent/tool-registry", () => ({
  getToolRegistry: () => ({
    dispatch: jest.fn(async (name: string, _args: unknown) => ({
      content: `Result of ${name}`,
    })),
  }),
}));

// Mock normalizeToolName — pass-through
jest.mock("@/lib/agent/discovery", () => ({
  normalizeToolName: (name: string) => name,
}));

import { executeToolWithPolicy } from "@/lib/agent/tool-executor";
import type { ToolExecutorDeps } from "@/lib/agent/tool-executor-deps";

let userId: string;

function makeDeps(threadId: string, overrides: Partial<ToolExecutorDeps> = {}): ToolExecutorDeps {
  return {
    addLog: jest.fn(),
    getUserById: jest.fn(() => ({ display_name: "Test User", email: "test@test.com" })),
    getToolPolicy: (name: string) => getToolPolicy(name) as ReturnType<ToolExecutorDeps["getToolPolicy"]>,
    createApprovalRequest: jest.fn(() => ({ id: "approval-gk-test" })),
    updateThreadStatus: jest.fn(),
    addMessage: jest.fn(),
    getThread: jest.fn(() => ({
      id: threadId,
      user_id: userId,
      thread_type: "proactive" as const,
      channel_id: null,
      external_sender_id: null,
    })),
    findApprovalPreferenceDecision: jest.fn(() => null),
    getChannel: jest.fn(() => undefined),
    notifyAdmin: jest.fn(async () => {}),
    ...overrides,
  };
}

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "gatekeeper@test.com" });
});
afterAll(() => teardownTestDb());

describe("executeToolWithPolicy — default-deny for MCP tools", () => {
  let threadId: string;

  beforeEach(() => {
    const thread = createThread("GK Test Thread", userId);
    threadId = thread.id;
  });

  test("MCP tool with no policy requires approval (default-deny)", async () => {
    // No policy exists for this tool — should be gated
    expect(getToolPolicy("mcp_tool_no_policy")).toBeUndefined();

    const result = await executeToolWithPolicy(
      { id: "tc-1", name: "mcp_tool_no_policy", arguments: { key: "value" } },
      threadId,
      "test reasoning",
      userId,
      makeDeps(threadId)
    );

    expect(result.status).toBe("pending_approval");
    expect(result.approvalId).toBeDefined();
  });

  test("MCP tool with requires_approval=1 requests approval", async () => {
    upsertToolPolicy({
      tool_name: "mcp_sensitive_tool",
      mcp_id: null,
      requires_approval: 1,
    });

    const result = await executeToolWithPolicy(
      { id: "tc-2", name: "mcp_sensitive_tool", arguments: {} },
      threadId,
      "test reasoning",
      userId,
      makeDeps(threadId)
    );

    expect(result.status).toBe("pending_approval");
    expect(result.approvalId).toBeDefined();
  });

  test("MCP tool with requires_approval=0 auto-executes", async () => {
    upsertToolPolicy({
      tool_name: "mcp_safe_tool",
      mcp_id: null,
      requires_approval: 0,
    });

    const result = await executeToolWithPolicy(
      { id: "tc-3", name: "mcp_safe_tool", arguments: {} },
      threadId,
      "test reasoning",
      userId,
      makeDeps(threadId)
    );

    expect(result.status).toBe("executed");
  });

  test("empty string userId falls back to thread user_id (not passed as empty)", async () => {
    upsertToolPolicy({
      tool_name: "mcp_safe_tool_userid",
      mcp_id: null,
      requires_approval: 0,
    });

    // Pass empty string as userId — the thread has a valid user_id.
    // Should execute successfully (not throw) because executor uses thread's user_id as fallback.
    const result = await executeToolWithPolicy(
      { id: "tc-4", name: "mcp_safe_tool_userid", arguments: {} },
      threadId,
      "test reasoning",
      "", // empty string — should fall back to thread.user_id
      makeDeps(threadId)
    );

    expect(result.status).toBe("executed");
  });
});

describe("Tool policy seeding", () => {
  test("FS destructive/write tools are defined in FS_TOOLS_REQUIRING_APPROVAL", () => {
    expect(FS_TOOLS_REQUIRING_APPROVAL).toContain("builtin.fs_create_file");
    expect(FS_TOOLS_REQUIRING_APPROVAL).toContain("builtin.fs_update_file");
    expect(FS_TOOLS_REQUIRING_APPROVAL).toContain("builtin.fs_delete_file");
    expect(FS_TOOLS_REQUIRING_APPROVAL).toContain("builtin.fs_delete_directory");
    expect(FS_TOOLS_REQUIRING_APPROVAL).toContain("builtin.fs_execute_script");
    // Read-only tools should NOT be in the list
    expect(FS_TOOLS_REQUIRING_APPROVAL).not.toContain("builtin.fs_read_file");
    expect(FS_TOOLS_REQUIRING_APPROVAL).not.toContain("builtin.fs_read_directory");
    expect(FS_TOOLS_REQUIRING_APPROVAL).not.toContain("builtin.fs_file_info");
    expect(FS_TOOLS_REQUIRING_APPROVAL).not.toContain("builtin.fs_search_files");
  });

  test("Network sensitive tools are defined in NETWORK_TOOLS_REQUIRING_APPROVAL", () => {
    expect(NETWORK_TOOLS_REQUIRING_APPROVAL).toContain("builtin.net_scan_network");
    expect(NETWORK_TOOLS_REQUIRING_APPROVAL).toContain("builtin.net_scan_ports");
    expect(NETWORK_TOOLS_REQUIRING_APPROVAL).toContain("builtin.net_connect_ssh");
    expect(NETWORK_TOOLS_REQUIRING_APPROVAL).toContain("builtin.net_http_request");
    expect(NETWORK_TOOLS_REQUIRING_APPROVAL).toContain("builtin.net_wake_on_lan");
    // Ping should NOT require approval
    expect(NETWORK_TOOLS_REQUIRING_APPROVAL).not.toContain("builtin.net_ping");
  });

  test("initializeDatabase seeds policies for ALL built-in tools", () => {
    // Re-run init to trigger the unified seeding
    const { initializeDatabase } = require("@/lib/db/init");
    initializeDatabase();

    const policies = listToolPolicies();
    const policyNames = policies.map((p: any) => p.tool_name);

    // Web tools should have policies
    expect(policyNames).toContain("builtin.web_search");
    expect(policyNames).toContain("builtin.web_fetch");
    expect(policyNames).toContain("builtin.web_extract");

    // Browser tools should have policies
    expect(policyNames).toContain("builtin.browser_navigate");
    expect(policyNames).toContain("builtin.browser_click");

    // FS tools should have policies
    expect(policyNames).toContain("builtin.fs_read_file");
    expect(policyNames).toContain("builtin.fs_update_file");

    // Network tools should have policies
    expect(policyNames).toContain("builtin.net_ping");
    expect(policyNames).toContain("builtin.net_scan_network");

    // Communication tools should have policies
    expect(policyNames).toContain("builtin.channel_send");
    expect(policyNames).toContain("builtin.channel_notify");
    expect(policyNames).toContain("builtin.channel_receive");

    // Custom toolmaker tools should have policies
    expect(policyNames).toContain("builtin.nexus_create_tool");
    expect(policyNames).toContain("builtin.nexus_delete_custom_tool");
    expect(policyNames).toContain("builtin.nexus_list_custom_tools");
  });

  test("dangerous tools have requires_approval=1, safe tools have requires_approval=0", () => {
    const { initializeDatabase } = require("@/lib/db/init");
    initializeDatabase();

    // Dangerous: must require approval
    const fsUpdate = getToolPolicy("builtin.fs_update_file");
    expect(fsUpdate?.requires_approval).toBe(1);

    const netScan = getToolPolicy("builtin.net_scan_network");
    expect(netScan?.requires_approval).toBe(1);

    const createTool = getToolPolicy("builtin.nexus_create_tool");
    expect(createTool?.requires_approval).toBe(1);

    const channelSend = getToolPolicy("builtin.channel_send");
    expect(channelSend?.requires_approval).toBe(0);

    const channelNotify = getToolPolicy("builtin.channel_notify");
    expect(channelNotify?.requires_approval).toBe(0);

    // Safe: no approval required
    const webSearch = getToolPolicy("builtin.web_search");
    expect(webSearch?.requires_approval).toBe(0);

    const ping = getToolPolicy("builtin.net_ping");
    expect(ping?.requires_approval).toBe(0);

    const browserNav = getToolPolicy("builtin.browser_navigate");
    expect(browserNav?.requires_approval).toBe(0);
  });

  test("Communication tools are not in approval-required defaults", () => {
    expect(COMMUNICATION_TOOLS_REQUIRING_APPROVAL).not.toContain("builtin.channel_send");
    expect(COMMUNICATION_TOOLS_REQUIRING_APPROVAL).not.toContain("builtin.channel_notify");
    expect(COMMUNICATION_TOOLS_REQUIRING_APPROVAL).not.toContain("builtin.channel_receive");
  });

});

describe("Tool policy preference decisions — via real DB", () => {
  let threadId: string;

  beforeEach(() => {
    const thread = createThread("Preference Decision Test Thread", userId);
    threadId = thread.id;
  });

  test("auto-approved by preference executes tool without creating approval request", async () => {
    upsertToolPolicy({
      tool_name: "pref_approved_tool",
      mcp_id: null,
      requires_approval: 1,
      scope: "global",
    });

    const deps = makeDeps(threadId, {
      findApprovalPreferenceDecision: jest.fn(() => "approved"),
    });

    const result = await executeToolWithPolicy(
      { id: "tc-pref-1", name: "pref_approved_tool", arguments: {} },
      threadId,
      "test reasoning",
      userId,
      deps,
    );

    expect(result.status).toBe("executed");
    expect(deps.createApprovalRequest).not.toHaveBeenCalled();
  });

  test("auto-rejected by preference returns error without creating approval request", async () => {
    upsertToolPolicy({
      tool_name: "pref_rejected_tool",
      mcp_id: null,
      requires_approval: 1,
      scope: "global",
    });

    const deps = makeDeps(threadId, {
      findApprovalPreferenceDecision: jest.fn(() => "rejected"),
    });

    const result = await executeToolWithPolicy(
      { id: "tc-pref-2", name: "pref_rejected_tool", arguments: {} },
      threadId,
      "test reasoning",
      userId,
      deps,
    );

    expect(result.status).toBe("error");
    expect(result.error).toContain("Auto-rejected");
    expect(deps.createApprovalRequest).not.toHaveBeenCalled();
  });

  test("auto-ignored by preference returns executed with ignored result", async () => {
    upsertToolPolicy({
      tool_name: "pref_ignored_tool",
      mcp_id: null,
      requires_approval: 1,
      scope: "global",
    });

    const deps = makeDeps(threadId, {
      findApprovalPreferenceDecision: jest.fn(() => "ignored"),
    });

    const result = await executeToolWithPolicy(
      { id: "tc-pref-3", name: "pref_ignored_tool", arguments: {} },
      threadId,
      "test reasoning",
      userId,
      deps,
    );

    expect(result.status).toBe("executed");
    expect((result as { status: "executed"; result: { status: string } }).result.status).toBe("ignored");
  });
});
