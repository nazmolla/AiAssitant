/**
 * Proactive Scan Tool
 *
 * Runs a proactive scan to check for pending tasks, notifications,
 * and system events that need attention.
 *
 * @see https://github.com/nazmolla/AiAssitant/issues/145
 */

import type { ToolDefinition } from "@/lib/llm";
import { BaseTool, type ToolExecutionContext } from "./base-tool";

export class ProactiveScanTool extends BaseTool {
  readonly name = "proactive_scan";
  readonly toolNamePrefix = "builtin.workflow_proactive_scan";
  readonly toolsRequiringApproval: string[] = [];
  readonly tools: ToolDefinition[] = [
    {
      name: "builtin.workflow_proactive_scan",
      description: "Run a proactive scan to check for pending tasks, notifications, and system events that need attention.",
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
    const { runProactiveScan } = await import("@/lib/scheduler");
    await runProactiveScan();
    return { status: "completed", kind: "proactive_scan" };
  }
}

export const proactiveScanTool = new ProactiveScanTool();
