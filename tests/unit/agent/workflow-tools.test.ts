/**
 * Unit tests — WorkflowTools composite and system tool subclasses
 *
 * Tests:
 * - WorkflowTools composition and dispatch
 * - ProactiveScanTool, KnowledgeMaintenanceTool, DbMaintenanceTool, EmailReadTool
 * - BaseTool inheritance for all system tools
 * - matches() and toolNamePrefix for each tool
 * - isWorkflowTool() helper
 *
 * @see https://github.com/nazmolla/AiAssitant/issues/145
 */

jest.mock("@/lib/scheduler", () => ({
  runProactiveScan: jest.fn().mockResolvedValue(undefined),
  runEmailReadBatch: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/lib/knowledge-maintenance", () => ({
  runKnowledgeMaintenanceIfDue: jest.fn().mockReturnValue({ status: "skipped", reason: "not due" }),
}));

jest.mock("@/lib/db", () => ({
  ...jest.requireActual("@/lib/db"),
  runDbMaintenanceIfDue: jest.fn().mockReturnValue({ deletedLogs: 0, vacuumed: false }),
}));

import { BaseTool } from "@/lib/tools/base-tool";
import {
  WorkflowTools,
  workflowTools,
  BUILTIN_WORKFLOW_TOOLS,
  WORKFLOW_TOOLS_REQUIRING_APPROVAL,
  isWorkflowTool,
} from "@/lib/tools/workflow-tools";
import { ProactiveScanTool, proactiveScanTool } from "@/lib/tools/proactive-scan-tool";
import { KnowledgeMaintenanceTool, knowledgeMaintenanceTool } from "@/lib/tools/knowledge-maintenance-tool";
import { DbMaintenanceTool, dbMaintenanceTool } from "@/lib/tools/db-maintenance-tool";
import { EmailReadTool, emailReadTool } from "@/lib/tools/email-read-tool";

const ctx = { threadId: "", userId: "" };

/* ══════════════════════════════════════════════════════════════════
   System tool instances — BaseTool compliance
   ══════════════════════════════════════════════════════════════════ */

describe.each([
  ["ProactiveScanTool", proactiveScanTool, "builtin.workflow_proactive_scan"],
  ["KnowledgeMaintenanceTool", knowledgeMaintenanceTool, "builtin.workflow_knowledge_maintenance"],
  ["DbMaintenanceTool", dbMaintenanceTool, "builtin.workflow_db_maintenance"],
  ["EmailReadTool", emailReadTool, "builtin.workflow_email_read"],
] as const)("%s", (_name, tool, expectedPrefix) => {
  test("extends BaseTool", () => {
    expect(tool).toBeInstanceOf(BaseTool);
  });

  test("has correct toolNamePrefix", () => {
    expect(tool.toolNamePrefix).toBe(expectedPrefix);
  });

  test("has at least one tool definition", () => {
    expect(tool.tools.length).toBeGreaterThanOrEqual(1);
  });

  test("tool name starts with the prefix", () => {
    for (const def of tool.tools) {
      expect(def.name.startsWith("builtin.workflow_")).toBe(true);
    }
  });

  test("matches() returns true for its own tool name", () => {
    expect(tool.matches(expectedPrefix)).toBe(true);
  });

  test("matches() returns false for other workflow tools", () => {
    const otherTools = [
      "builtin.workflow_proactive_scan",
      "builtin.workflow_knowledge_maintenance",
      "builtin.workflow_db_maintenance",
      "builtin.workflow_email_read",
    ].filter((t) => t !== expectedPrefix);
    for (const other of otherTools) {
      expect(tool.matches(other)).toBe(false);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════
   Individual system tool execution
   ══════════════════════════════════════════════════════════════════ */

describe("ProactiveScanTool.execute()", () => {
  test("calls runProactiveScan and returns result", async () => {
    const result = await proactiveScanTool.execute(
      "builtin.workflow_proactive_scan", {}, ctx,
    );
    expect(result).toEqual({ status: "completed", kind: "proactive_scan" });
    const { runProactiveScan } = require("@/lib/scheduler");
    expect(runProactiveScan).toHaveBeenCalledTimes(1);
  });
});

describe("KnowledgeMaintenanceTool.execute()", () => {
  test("calls runKnowledgeMaintenanceIfDue and returns result", async () => {
    const result = await knowledgeMaintenanceTool.execute(
      "builtin.workflow_knowledge_maintenance", {}, ctx,
    ) as { status: string; kind: string; result: unknown };
    expect(result.status).toBe("completed");
    expect(result.kind).toBe("knowledge_maintenance");
    expect(result.result).toEqual({ status: "skipped", reason: "not due" });
  });
});

describe("DbMaintenanceTool.execute()", () => {
  test("calls runDbMaintenanceIfDue and returns result", async () => {
    const result = await dbMaintenanceTool.execute(
      "builtin.workflow_db_maintenance", {}, ctx,
    ) as { status: string; kind: string; result: unknown };
    expect(result.status).toBe("completed");
    expect(result.kind).toBe("db_maintenance");
    expect(result.result).toEqual({ deletedLogs: 0, vacuumed: false });
  });
});

describe("EmailReadTool.execute()", () => {
  test("calls runEmailReadBatch with maxMessages from args", async () => {
    await emailReadTool.execute(
      "builtin.workflow_email_read", { maxMessages: 10 }, ctx,
    );
    const { runEmailReadBatch } = require("@/lib/scheduler");
    expect(runEmailReadBatch).toHaveBeenCalledWith(10);
  });

  test("defaults maxMessages to 25", async () => {
    await emailReadTool.execute(
      "builtin.workflow_email_read", {}, ctx,
    );
    const { runEmailReadBatch } = require("@/lib/scheduler");
    expect(runEmailReadBatch).toHaveBeenCalledWith(25);
  });
});

/* ══════════════════════════════════════════════════════════════════
   WorkflowTools composite
   ══════════════════════════════════════════════════════════════════ */

describe("WorkflowTools", () => {
  test("extends BaseTool", () => {
    expect(workflowTools).toBeInstanceOf(BaseTool);
  });

  test("name is 'workflow'", () => {
    expect(workflowTools.name).toBe("workflow");
  });

  test("toolNamePrefix is 'builtin.workflow_'", () => {
    expect(workflowTools.toolNamePrefix).toBe("builtin.workflow_");
  });

  test("matches() returns true for any builtin.workflow_ prefixed name", () => {
    expect(workflowTools.matches("builtin.workflow_proactive_scan")).toBe(true);
    expect(workflowTools.matches("builtin.workflow_anything")).toBe(true);
  });

  test("matches() returns false for non-workflow names", () => {
    expect(workflowTools.matches("builtin.web_search")).toBe(false);
    expect(workflowTools.matches("custom.my_tool")).toBe(false);
  });
});

describe("BUILTIN_WORKFLOW_TOOLS", () => {
  test("aggregates definitions from all 4 system tools", () => {
    expect(BUILTIN_WORKFLOW_TOOLS.length).toBe(4);
  });

  test("all tool names start with builtin.workflow_", () => {
    for (const def of BUILTIN_WORKFLOW_TOOLS) {
      expect(def.name.startsWith("builtin.workflow_")).toBe(true);
    }
  });
});

describe("isWorkflowTool()", () => {
  test("returns true for workflow tool names", () => {
    expect(isWorkflowTool("builtin.workflow_proactive_scan")).toBe(true);
    expect(isWorkflowTool("builtin.workflow_email_read")).toBe(true);
  });

  test("returns false for non-workflow tool names", () => {
    expect(isWorkflowTool("builtin.web_search")).toBe(false);
    expect(isWorkflowTool("custom.my_tool")).toBe(false);
  });
});

describe("WorkflowTools.execute() dispatch", () => {
  test("dispatches to ProactiveScanTool for proactive_scan", async () => {
    const result = await workflowTools.execute(
      "builtin.workflow_proactive_scan", {}, ctx,
    );
    expect(result).toEqual({ status: "completed", kind: "proactive_scan" });
  });

  test("dispatches to EmailReadTool for email_read", async () => {
    await workflowTools.execute(
      "builtin.workflow_email_read", { maxMessages: 5 }, ctx,
    );
    const { runEmailReadBatch } = require("@/lib/scheduler");
    expect(runEmailReadBatch).toHaveBeenCalled();
  });

  test("throws for unknown workflow tool name", async () => {
    await expect(
      workflowTools.execute("builtin.workflow_unknown_xyz", {}, ctx),
    ).rejects.toThrow('No workflow tool handles "builtin.workflow_unknown_xyz"');
  });
});

describe("WorkflowTools DI constructor", () => {
  test("accepts custom children for testing", async () => {
    const mockChild: BaseTool = {
      name: "mock",
      toolNamePrefix: "mock.",
      tools: [{ name: "mock.test", description: "mock", inputSchema: {} }],
      toolsRequiringApproval: [],
      matches: (n: string) => n.startsWith("mock."),
      execute: jest.fn(async () => "mock-result"),
    } as unknown as BaseTool;

    const custom = new WorkflowTools([mockChild]);
    const result = await custom.execute("mock.test", {}, ctx);
    expect(result).toBe("mock-result");
    expect(mockChild.execute).toHaveBeenCalledWith("mock.test", {}, ctx);
  });
});
