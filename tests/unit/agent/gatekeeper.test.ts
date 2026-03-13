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
import { EMAIL_TOOLS_REQUIRING_APPROVAL } from "@/lib/tools/email-tools";
import { ALEXA_TOOLS_REQUIRING_APPROVAL } from "@/lib/tools/alexa-tools";

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

describe("executeWithGatekeeper — default-deny for MCP tools", () => {
  let threadId: string;

  beforeEach(() => {
    const thread = createThread("GK Test Thread", userId);
    threadId = thread.id;
  });

  test("MCP tool with no policy requires approval (default-deny)", async () => {
    // No policy exists for this tool — should be gated
    expect(getToolPolicy("mcp_tool_no_policy")).toBeUndefined();

    const result = await executeWithGatekeeper(
      { id: "tc-1", name: "mcp_tool_no_policy", arguments: { key: "value" } },
      threadId,
      "test reasoning"
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

    // Email tools should have policies
    expect(policyNames).toContain("builtin.email_send");

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

    const emailSend = getToolPolicy("builtin.email_send");
    expect(emailSend?.requires_approval).toBe(0);

    // Safe: no approval required
    const webSearch = getToolPolicy("builtin.web_search");
    expect(webSearch?.requires_approval).toBe(0);

    const ping = getToolPolicy("builtin.net_ping");
    expect(ping?.requires_approval).toBe(0);

    const browserNav = getToolPolicy("builtin.browser_navigate");
    expect(browserNav?.requires_approval).toBe(0);
  });

  test("Email send tool is not in approval-required defaults", () => {
    expect(EMAIL_TOOLS_REQUIRING_APPROVAL).not.toContain("builtin.email_send");
  });

  test("Alexa mutating tools are defined in ALEXA_TOOLS_REQUIRING_APPROVAL", () => {
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).toContain("builtin.alexa_announce");
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).toContain("builtin.alexa_set_light_power");
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).toContain("builtin.alexa_set_light_brightness");
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).toContain("builtin.alexa_set_light_color");
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).toContain("builtin.alexa_set_device_volume");
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).toContain("builtin.alexa_adjust_device_volume");
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).toContain("builtin.alexa_set_dnd_status");
    // Read-only Alexa tools should NOT require approval
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).not.toContain("builtin.alexa_get_bedroom_state");
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).not.toContain("builtin.alexa_list_lights");
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).not.toContain("builtin.alexa_get_music_status");
    expect(ALEXA_TOOLS_REQUIRING_APPROVAL).not.toContain("builtin.alexa_get_dnd_status");
  });

  test("initializeDatabase seeds policies for Alexa tools", () => {
    const { initializeDatabase } = require("@/lib/db/init");
    initializeDatabase();

    const policies = listToolPolicies();
    const policyNames = policies.map((p: any) => p.tool_name);

    // Alexa tools should have policies
    expect(policyNames).toContain("builtin.alexa_announce");
    expect(policyNames).toContain("builtin.alexa_get_bedroom_state");
    expect(policyNames).toContain("builtin.alexa_list_lights");
    expect(policyNames).toContain("builtin.alexa_set_light_power");
    expect(policyNames).toContain("builtin.alexa_get_dnd_status");
    expect(policyNames).toContain("builtin.alexa_set_dnd_status");
  });

  test("Alexa mutating tools have requires_approval=1, read-only have 0", () => {
    const { initializeDatabase } = require("@/lib/db/init");
    initializeDatabase();

    // Mutating: requires approval
    const announce = getToolPolicy("builtin.alexa_announce");
    expect(announce?.requires_approval).toBe(1);

    const setLightPower = getToolPolicy("builtin.alexa_set_light_power");
    expect(setLightPower?.requires_approval).toBe(1);

    const setDnd = getToolPolicy("builtin.alexa_set_dnd_status");
    expect(setDnd?.requires_approval).toBe(1);

    // Read-only: no approval
    const getState = getToolPolicy("builtin.alexa_get_bedroom_state");
    expect(getState?.requires_approval).toBe(0);

    const listLights = getToolPolicy("builtin.alexa_list_lights");
    expect(listLights?.requires_approval).toBe(0);

    const getDnd = getToolPolicy("builtin.alexa_get_dnd_status");
    expect(getDnd?.requires_approval).toBe(0);
  });
});
