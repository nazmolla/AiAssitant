import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { listPendingApprovals, getApprovalById, updateApprovalStatus, getThreadMessages, addMessage, getThread } from "@/lib/db";
import { executeApprovedTool, continueAgentLoop } from "@/lib/agent";
import type { ToolCall } from "@/lib/llm";

export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  // Admins see all pending approvals; regular users see only their own threads
  const all = listPendingApprovals();
  const pending = auth.user.role === "admin"
    ? all
    : all.filter((a) => {
        if (!a.thread_id) return false;
        const thread = getThread(a.thread_id);
        return thread?.user_id === auth.user.id;
      });

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
  const auth = await requireUser();
  if ("error" in auth) return auth.error;

  const body = await req.json();
  const { approvalId, action } = body;

  if (!approvalId || !["approved", "rejected"].includes(action)) {
    return NextResponse.json(
      { error: "approvalId and action ('approved' | 'rejected') are required." },
      { status: 400 }
    );
  }

  // Find the approval — look up by ID directly (not just pending)
  const approval = getApprovalById(approvalId);

  if (!approval) {
    return NextResponse.json({ error: "Approval not found." }, { status: 404 });
  }

  // If already resolved, return success with the existing status
  if (approval.status !== "pending") {
    return NextResponse.json({ status: approval.status, alreadyResolved: true });
  }

  // Ensure user is admin or owns the thread
  if (auth.user.role !== "admin" && approval.thread_id) {
    const thread = getThread(approval.thread_id);
    if (!thread || thread.user_id !== auth.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
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
