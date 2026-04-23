/**
 * Unit tests — approval preference wildcard support
 *
 * Validates:
 * - Exact-match preference is returned when it matches
 * - Wildcard preference is returned as fallback when no exact match
 * - Exact match takes priority over wildcard when both exist
 * - upsertWildcardApprovalPreference stores and retrieves correctly
 * - isAlwaysApproval matches expected phrases
 */
import { setupTestDb, teardownTestDb, seedTestUser } from "../../helpers/test-db";
import {
  upsertApprovalPreferenceFromApproval,
  upsertWildcardApprovalPreference,
  findApprovalPreferenceDecision,
} from "@/lib/db/tool-policy-queries";
import type { ApprovalRequest } from "@/lib/db/tool-policy-queries";
import { isAlwaysApproval } from "@/lib/agent/approval-handler";

let userId: string;

function makeSyntheticApproval(toolName: string, args: Record<string, unknown> = {}): ApprovalRequest {
  return {
    id: "test-approval-id",
    thread_id: "test-thread",
    tool_name: toolName,
    args: JSON.stringify(args),
    reasoning: "test reason",
    nl_request: "test nl",
    source: "chat",
    status: "approved",
    expires_at: null,
    created_at: new Date().toISOString(),
  };
}

beforeAll(() => {
  setupTestDb();
  userId = seedTestUser({ email: "approval-pref@test.com" });
});
afterAll(() => teardownTestDb());

describe("findApprovalPreferenceDecision — exact match", () => {
  test("returns decision when exact signature matches", () => {
    const approval = makeSyntheticApproval("mcp.some_tool", { service: "lights" });
    upsertApprovalPreferenceFromApproval(userId, approval, "approved");

    const result = findApprovalPreferenceDecision(
      userId,
      "mcp.some_tool",
      JSON.stringify({ service: "lights" }),
      "test reason",
      "test nl"
    );
    expect(result).toBe("approved");
  });

  test("returns null when nlRequest differs (no match, no wildcard)", () => {
    const approval = makeSyntheticApproval("mcp.some_tool_2");
    approval.nl_request = "turn on lights";
    upsertApprovalPreferenceFromApproval(userId, approval, "approved");

    const result = findApprovalPreferenceDecision(
      userId,
      "mcp.some_tool_2",
      JSON.stringify({}),
      "test reason",
      "turn off lights"  // different nlRequest → different request_key
    );
    expect(result).toBeNull();
  });
});

describe("findApprovalPreferenceDecision — wildcard fallback", () => {
  test("returns wildcard decision when no exact match exists", () => {
    upsertWildcardApprovalPreference(userId, "mcp.wild_tool", "approved");

    const result = findApprovalPreferenceDecision(
      userId,
      "mcp.wild_tool",
      JSON.stringify({ command: "anything", target: "somewhere" }),
      "some completely different reason",
      "some nl"
    );
    expect(result).toBe("approved");
  });

  test("wildcard rejected preference blocks any call to that tool", () => {
    upsertWildcardApprovalPreference(userId, "mcp.blocked_tool", "rejected");

    const result = findApprovalPreferenceDecision(
      userId,
      "mcp.blocked_tool",
      JSON.stringify({ anything: "goes" }),
      null,
      null
    );
    expect(result).toBe("rejected");
  });

  test("exact match takes priority over wildcard", () => {
    // Save wildcard as rejected
    upsertWildcardApprovalPreference(userId, "mcp.priority_tool", "rejected");
    // Save exact match as approved (should win)
    const approval = makeSyntheticApproval("mcp.priority_tool", { service: "lights" });
    upsertApprovalPreferenceFromApproval(userId, approval, "approved");

    const result = findApprovalPreferenceDecision(
      userId,
      "mcp.priority_tool",
      JSON.stringify({ service: "lights" }),
      "test reason",
      "test nl"
    );
    expect(result).toBe("approved");  // exact wins over wildcard rejected
  });

  test("returns null when no preference exists at all", () => {
    const result = findApprovalPreferenceDecision(
      userId,
      "mcp.unknown_tool",
      JSON.stringify({}),
      null,
      null
    );
    expect(result).toBeNull();
  });
});

describe("upsertWildcardApprovalPreference", () => {
  test("overwrites existing wildcard with new decision", () => {
    upsertWildcardApprovalPreference(userId, "mcp.flip_tool", "approved");
    upsertWildcardApprovalPreference(userId, "mcp.flip_tool", "rejected");

    const result = findApprovalPreferenceDecision(
      userId,
      "mcp.flip_tool",
      JSON.stringify({ x: "y" }),
      null,
      null
    );
    expect(result).toBe("rejected");
  });
});

describe("isAlwaysApproval", () => {
  test.each([
    ["always", true],
    ["always approve", true],
    ["trust", true],
    ["trust this", true],
    ["trust always", true],
    ["ALWAYS", true],
    ["Always Approve", true],
    ["approve", false],
    ["yes", false],
    ["no", false],
    ["reject", false],
    ["always reject", false],
  ])('isAlwaysApproval("%s") → %s', (input, expected) => {
    expect(isAlwaysApproval(input)).toBe(expected);
  });
});
