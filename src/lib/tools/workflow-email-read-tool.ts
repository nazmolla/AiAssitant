import type { ToolDefinition } from "@/lib/llm";
import { BaseTool, type ToolExecutionContext } from "./base-tool";
import {
  type SchedulerBatchExecutionContext,
  mergeBatchContext,
} from "@/lib/scheduler/shared";
import { addLog } from "@/lib/db";

export async function runEmailReadToolExecution(context?: SchedulerBatchExecutionContext): Promise<void> {
  addLog({
    level: "info",
    source: "scheduler",
    message: "workflow_email_read executed. Use channel tooling for communication flows.",
    metadata: JSON.stringify(mergeBatchContext({}, context)),
  });
}

export class EmailReadTool extends BaseTool {
  readonly name = "email_read";
  readonly toolNamePrefix = "builtin.workflow_email_read";
  readonly toolsRequiringApproval: string[] = [];
  readonly tools: ToolDefinition[] = [
    {
      name: "builtin.workflow_email_read",
      description: "Run the workflow email-read maintenance pass.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ];

  constructor(
    private readonly runEmailReadFn: (context?: SchedulerBatchExecutionContext) => Promise<void> = runEmailReadToolExecution,
  ) {
    super();
  }

  override matches(toolName: string): boolean {
    return toolName === this.toolNamePrefix;
  }

  async execute(
    _toolName: string,
    _args: Record<string, unknown>,
    _context: ToolExecutionContext,
  ): Promise<unknown> {
    await this.runEmailReadFn();
    return { status: "completed", kind: "email_read" };
  }
}

export const emailReadTool = new EmailReadTool();