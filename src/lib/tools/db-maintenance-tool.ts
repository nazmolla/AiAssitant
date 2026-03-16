/**
 * DB Maintenance Tool
 *
 * Runs database maintenance: log cleanup, retention validation,
 * and integrity checks.
 *
 * @see https://github.com/nazmolla/AiAssitant/issues/145
 */

import type { ToolDefinition } from "@/lib/llm";
import { BaseTool, type ToolExecutionContext } from "./base-tool";

export class DbMaintenanceTool extends BaseTool {
  readonly name = "db_maintenance";
  readonly toolNamePrefix = "builtin.workflow_db_maintenance";
  readonly toolsRequiringApproval: string[] = [];
  readonly tools: ToolDefinition[] = [
    {
      name: "builtin.workflow_db_maintenance",
      description: "Run database maintenance: log cleanup, retention validation, and integrity checks.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ];

  override matches(toolName: string): boolean {
    return toolName === this.toolNamePrefix;
  }

  async execute(
    _toolName: string,
    _args: Record<string, unknown>,
    _context: ToolExecutionContext,
  ): Promise<unknown> {
    const { runDbMaintenanceIfDue } = await import("@/lib/db");
    const result = runDbMaintenanceIfDue();
    return { status: "completed", kind: "db_maintenance", result };
  }
}

export const dbMaintenanceTool = new DbMaintenanceTool();
