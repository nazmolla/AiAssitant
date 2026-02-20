import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { listPendingApprovals, updateApprovalStatus, getThreadMessages, addMessage } from "@/lib/db";
import { executeApprovedTool, continueAgentLoop } from "@/lib/agent";
import type { ToolCall } from "@/lib/llm";

export async function GET() {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const pending = listPendingApprovals();
  return NextResponse.json(pending);
}

/**
 * Find the tool_call_id for a given tool name from the thread's message history.
 * Searches backwards to find the most recent assistant message containing this tool call.
 */
function findToolCallId(threadId: string, toolName: string): string | undefined {
  const messages = getThreadMessages(threadId);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "assistant" && m.tool_calls) {
      try {
        const toolCalls: ToolCall[] = JSON.parse(m.tool_calls);
        const match = toolCalls.find((tc) => tc.name === toolName);
        if (match) return match.id;
      } catch {}
    }
  }
  return undefined;
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;

  const body = await req.json();
  const { approvalId, action } = body;

  if (!approvalId || !["approved", "rejected"].includes(action)) {
    return NextResponse.json(
      { error: "approvalId and action ('approved' | 'rejected') are required." },
      { status: 400 }
    );
  }

  // Find the approval
  const pending = listPendingApprovals();
  const approval = pending.find((a) => a.id === approvalId);

  if (!approval) {
    return NextResponse.json({ error: "Approval not found or already resolved." }, { status: 404 });
  }

  updateApprovalStatus(approvalId, action);

  if (action === "approved" && approval.thread_id) {
    // Execute the tool now
    const args = JSON.parse(approval.args);
    const result = await executeApprovedTool(approval.tool_name, args, approval.thread_id);

    if (result.status === "executed") {
      // Find the original tool_call_id so the LLM can match the result
      const toolCallId = findToolCallId(approval.thread_id, approval.tool_name);

      if (toolCallId) {
        // Save the tool result as a message so it appears in thread history
        const toolResultContent = JSON.stringify(result.result);
        addMessage({
          thread_id: approval.thread_id,
          role: "tool",
          content: toolResultContent.length > 15000
            ? toolResultContent.slice(0, 15000) + "\n... [truncated]"
            : toolResultContent,
          tool_calls: null,
          tool_results: JSON.stringify({
            tool_call_id: toolCallId,
            name: approval.tool_name,
            result: result.result,
          }),
          attachments: null,
        });
      }

      // Resume the agent loop so the LLM can process the tool result
      try {
        const agentResponse = await continueAgentLoop(approval.thread_id);
        return NextResponse.json({
          status: "approved",
          result,
          agentResponse,
        });
      } catch (err) {
        // Tool executed successfully but continuation failed — still report success
        const errorMsg = err instanceof Error ? err.message : String(err);
        return NextResponse.json({
          status: "approved",
          result,
          continuationError: errorMsg,
        });
      }
    }

    return NextResponse.json({ status: "approved", result });
  }

  return NextResponse.json({ status: action });
}
