/**
 * Workflow Tools
 *
 * Composite tool category that aggregates all workflow-related tools
 * under the `builtin.workflow_` prefix. Each tool is a proper BaseTool
 * subclass injected via composition — no switch statements.
 *
 * System tools (proactive scan, knowledge maintenance, DB maintenance,
 * email read) are each their own BaseTool subclass in dedicated files.
 *
 * Prompt tools (PromptTool instances) are not registered here — they
 * are instantiated by the batch jobs that use them.
 *
 * @see https://github.com/nazmolla/AiAssitant/issues/145
 */

import type { ToolDefinition } from "@/lib/llm";
import { BaseTool, type ToolCategory, type ToolExecutionContext, registerToolCategory } from "./base-tool";
import { proactiveScanTool } from "./proactive-scan-tool";
import { knowledgeMaintenanceTool } from "./knowledge-maintenance-tool";
import { dbMaintenanceTool } from "./db-maintenance-tool";
import { emailReadTool } from "./email-tools";

/**
 * All system workflow tools, injected as proper BaseTool instances.
 */
const SYSTEM_TOOLS: BaseTool[] = [
  proactiveScanTool,
  knowledgeMaintenanceTool,
  dbMaintenanceTool,
  emailReadTool,
];

/** All tool definitions aggregated from child tools */
export const BUILTIN_WORKFLOW_TOOLS: ToolDefinition[] =
  SYSTEM_TOOLS.flatMap((t) => t.tools);

export const WORKFLOW_TOOLS_REQUIRING_APPROVAL: string[] =
  SYSTEM_TOOLS.flatMap((t) => t.toolsRequiringApproval);

export function isWorkflowTool(name: string): boolean {
  return name.startsWith("builtin.workflow_");
}

/**
 * WorkflowTools — composite tool category for all workflow subtasks.
 *
 * Dispatches to the child tool whose `matches()` returns true.
 * No switch statements — just polymorphic dispatch.
 */
export class WorkflowTools extends BaseTool {
  readonly name = "workflow";
  readonly toolNamePrefix = "builtin.workflow_";
  readonly registrationOrder = 70;
  readonly tools = BUILTIN_WORKFLOW_TOOLS;
  readonly toolsRequiringApproval = [...WORKFLOW_TOOLS_REQUIRING_APPROVAL];

  private readonly children: ToolCategory[];

  constructor(children: ToolCategory[] = SYSTEM_TOOLS) {
    super();
    this.children = children;
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<unknown> {
    for (const child of this.children) {
      if (child.matches(toolName)) {
        return child.execute(toolName, args, context);
      }
    }
    throw new Error(`No workflow tool handles "${toolName}"`);
  }
}

export const workflowTools = new WorkflowTools();
registerToolCategory(workflowTools);
