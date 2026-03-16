/**
 * Email Read Tool
 *
 * Reads incoming emails and processes them for the user.
 *
 * @see https://github.com/nazmolla/AiAssitant/issues/145
 */

import type { ToolDefinition } from "@/lib/llm";
import { BaseTool, type ToolExecutionContext } from "./base-tool";

export class EmailReadTool extends BaseTool {
  readonly name = "email_read";
  readonly toolNamePrefix = "builtin.workflow_email_read";
  readonly toolsRequiringApproval: string[] = [];
  readonly tools: ToolDefinition[] = [
    {
      name: "builtin.workflow_email_read",
      description: "Read incoming emails and process them for the user.",
      inputSchema: {
        type: "object",
        properties: {
          maxMessages: {
            type: "number",
            description: "Maximum number of messages to read per run (default: 25).",
          },
        },
      },
    },
  ];

  override matches(toolName: string): boolean {
    return toolName === this.toolNamePrefix;
  }

  async execute(
    _toolName: string,
    args: Record<string, unknown>,
    _context: ToolExecutionContext,
  ): Promise<unknown> {
    const maxMessages = typeof args.maxMessages === "number" ? args.maxMessages : 25;
    const { runEmailReadBatch } = await import("@/lib/scheduler");
    await runEmailReadBatch(maxMessages);
    return { status: "completed", kind: "email_read" };
  }
}

export const emailReadTool = new EmailReadTool();
