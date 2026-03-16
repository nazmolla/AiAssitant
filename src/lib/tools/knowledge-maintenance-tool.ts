/**
 * Knowledge Maintenance Tool
 *
 * Runs knowledge maintenance to update, re-index, and validate
 * knowledge vault entries.
 *
 * @see https://github.com/nazmolla/AiAssitant/issues/145
 */

import type { ToolDefinition } from "@/lib/llm";
import { BaseTool, type ToolExecutionContext } from "./base-tool";

export class KnowledgeMaintenanceTool extends BaseTool {
  readonly name = "knowledge_maintenance";
  readonly toolNamePrefix = "builtin.workflow_knowledge_maintenance";
  readonly toolsRequiringApproval: string[] = [];
  readonly tools: ToolDefinition[] = [
    {
      name: "builtin.workflow_knowledge_maintenance",
      description: "Run knowledge maintenance to update, re-index, and validate knowledge vault entries.",
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
    const { runKnowledgeMaintenanceIfDue } = await import("@/lib/knowledge-maintenance");
    const result = runKnowledgeMaintenanceIfDue();
    return { status: "completed", kind: "knowledge_maintenance", result };
  }
}

export const knowledgeMaintenanceTool = new KnowledgeMaintenanceTool();
