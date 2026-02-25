/**
 * Unit tests — Gatekeeper tool policy enforcement
 *
 * Validates that:
 * - MCP tools with no policy auto-execute (default-allow)
 * - MCP tools with requires_approval=1 request approval
 * - MCP tools with requires_approval=0 auto-execute
 * - Built-in FS destructive tools are seeded with requires_approval=1
 * - Built-in network sensitive tools are seeded with requires_approval=1
 */
import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import {
  upsertToolPolicy,
  getToolPolicy,
  createThread,
} from "@/lib/db/queries";
import { FS_TOOLS_REQUIRING_APPROVAL } from "@/lib/agent/fs-tools";
import { NETWORK_TOOLS_REQUIRING_APPROVAL } from "@/lib/agent/network-tools";

// Mock MCP manager so executeWithGatekeeper can call tools
jest.mock("@/lib/mcp", () => ({
  getMcpManager: () => ({
    callTool: jest.fn(async (name: string, _args: unknown) => ({
      content: `Result of ${name}`,
    })),
  }),
}));

import { executeWithGatekeeper } from "@/lib/agent/gatekeeper";

let userId: string;

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "gatekeeper@test.com" });
});
afterAll(() => teardownTestDb());

describe("executeWithGatekeeper — default-allow for MCP tools", () => {
  let threadId: string;

  beforeEach(() => {
    const thread = createThread("GK Test Thread", userId);
    threadId = thread.id;
  });

  test("MCP tool with no policy auto-executes (default-allow)", async () => {
    // No policy exists for this tool
    expect(getToolPolicy("mcp_tool_no_policy")).toBeUndefined();

    const result = await executeWithGatekeeper(
      { id: "tc-1", name: "mcp_tool_no_policy", arguments: { key: "value" } },
      threadId,
      "test reasoning"
    );

    expect(result.status).toBe("executed");
    expect(result.result).toBeDefined();
  });

  test("MCP tool with requires_approval=1 requests approval", async () => {
    upsertToolPolicy({
      tool_name: "mcp_sensitive_tool",
      mcp_id: null,
      requires_approval: 1,
      is_proactive_enabled: 0,
    });

    const result = await executeWithGatekeeper(
      { id: "tc-2", name: "mcp_sensitive_tool", arguments: {} },
      threadId,
      "test reasoning"
    );

    expect(result.status).toBe("pending_approval");
    expect(result.approvalId).toBeDefined();
  });

  test("MCP tool with requires_approval=0 auto-executes", async () => {
    upsertToolPolicy({
      tool_name: "mcp_safe_tool",
      mcp_id: null,
      requires_approval: 0,
      is_proactive_enabled: 0,
    });

    const result = await executeWithGatekeeper(
      { id: "tc-3", name: "mcp_safe_tool", arguments: {} },
      threadId,
      "test reasoning"
    );

    expect(result.status).toBe("executed");
  });
});

describe("Tool policy seeding", () => {
  test("FS destructive tools are defined in FS_TOOLS_REQUIRING_APPROVAL", () => {
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
});
