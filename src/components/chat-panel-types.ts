export interface Thread {
  id: string;
  title: string;
  status: string;
  last_message_at: string;
}

export interface AttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
}

export interface Message {
  id: number;
  thread_id: string;
  role: string;
  content: string | null;
  tool_calls: string | null;
  tool_results: string | null;
  attachments: string | null;
  created_at: string | null;
}

export interface PendingFile {
  file: File;
  previewUrl: string | null;
  uploading: boolean;
  uploaded?: AttachmentMeta;
}

export interface ThinkingStep {
  step: string;
  detail?: string;
  timestamp: number;
}

export interface ThoughtStep {
  thinking: string | null;
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  toolResults: Array<{ name: string; result: string }>;
  attachments: AttachmentMeta[];
}

export interface ProcessedMessage {
  msg: Message;
  attachments: AttachmentMeta[];
  approvalMeta: { approvalId: string; tool_name: string; args: Record<string, unknown>; reasoning: string | null } | null;
  displayContent: string | null;
  thoughts: ThoughtStep[];
}

export const ACCEPT_STRING = "*/*";

/** Sanitize tool message content: hide raw screenshot paths when attachments are present */
export function sanitizeToolContent(content: string | null, hasAttachments: boolean): string {
  if (!content) return hasAttachments ? "" : "(no content)";
  if (hasAttachments && (content.includes('"screenshotPath"') || content.includes('"relativePath"'))) {
    return "";
  }
  if (content.includes('"screenshotPath"') || content.includes('"relativePath"')) {
    return "📸 Screenshot captured.";
  }
  return content;
}

/** Extract approval metadata from a system message, if any */
export function extractApprovalMeta(content: string | null): { approvalId: string; tool_name: string; args: Record<string, unknown>; reasoning: string | null } | null {
  if (!content) return null;
  const match = content.match(/<!-- APPROVAL:(\{[\s\S]*?\}) -->/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/** Strip approval metadata marker from display text */
export function stripApprovalMeta(content: string | null): string {
  if (!content) return "";
  return content.replace(/\n?<!-- APPROVAL:\{[\s\S]*?\} -->/, "").trim();
}

/** Safely parse JSON with a fallback — prevents component crashes on malformed data */
export function safeJsonParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
}

/** Strip sandbox/file paths from assistant messages so users see clean text */
export function sanitizeAssistantContent(content: string | null, hasAttachments: boolean): string {
  if (!content) return hasAttachments ? "" : "(no content)";
  let cleaned = content;
  cleaned = cleaned.replace(/\[([^\]]*?)\]\(sandbox:[^)]*\)/g, "");
  cleaned = cleaned.replace(/\[([^\]]*?)\]\(\/home\/[^)]*\)/g, "");
  cleaned = cleaned.replace(/\[([^\]]*?)\]\(\/[a-zA-Z][^)]*\.png[^)]*\)/g, "");
  cleaned = cleaned.replace(/sandbox:\/[^\s)]+/g, "");
  cleaned = cleaned.replace(/\/home\/[^\s)]*screenshots\/[^\s)]+/g, "");
  cleaned = cleaned.replace(/\/home\/[^\s)]*\.png/g, "");
  cleaned = cleaned.replace(/You can view (?:it|the screenshot)\s*\.?\s*/gi, "");
  cleaned = cleaned.replace(/Here(?:'s| is) the screenshot\s*\.?/gi, (m) => m);
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  if (!cleaned && hasAttachments) return "";
  if (!cleaned) return "(no content)";
  return cleaned;
}

/**
 * Pre-process messages: group tool calls and thinking steps into collapsible
 * `ThoughtStep` blocks attached to their final assistant response.
 */
export function processMessages(
  messages: Message[],
  loading: boolean,
  thinkingSteps: ThinkingStep[]
): ProcessedMessage[] {
  const result: ProcessedMessage[] = [];
  let pendingThoughts: ThoughtStep[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Tool messages — collect results into the current thought step
    if (msg.role === "tool") {
      if (pendingThoughts.length > 0) {
        const lastThought = pendingThoughts[pendingThoughts.length - 1];
        let name = "tool";
        if (lastThought.toolCalls.length > 0) {
          const idx = lastThought.toolResults.length;
          if (idx < lastThought.toolCalls.length) {
            name = lastThought.toolCalls[idx].name;
          }
        }
        lastThought.toolResults.push({
          name,
          result: msg.content || "(no output)",
        });
        if (msg.attachments) {
          const toolAtts: AttachmentMeta[] = safeJsonParse(msg.attachments, []);
          lastThought.attachments.push(...toolAtts);
        }
      }
      continue;
    }

    // Assistant message WITH tool_calls = thinking step
    if (msg.role === "assistant" && msg.tool_calls) {
      let parsedCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
      try { parsedCalls = JSON.parse(msg.tool_calls).map((tc: { name: string; arguments: Record<string, unknown> }) => ({ name: tc.name, args: tc.arguments })); } catch { /* ignore */ }
      pendingThoughts.push({
        thinking: msg.content,
        toolCalls: parsedCalls,
        toolResults: [],
        attachments: safeJsonParse<AttachmentMeta[]>(msg.attachments, []),
      });
      continue;
    }

    // Final assistant message (no tool_calls) = visible response with collected thoughts
    if (msg.role === "assistant") {
      const attachments: AttachmentMeta[] = safeJsonParse<AttachmentMeta[]>(msg.attachments, []);
      const hasAtt = attachments.length > 0;
      const content = sanitizeAssistantContent(msg.content, hasAtt);
      if ((!content || content === "(no content)") && !hasAtt) {
        pendingThoughts = [];
        continue;
      }
      result.push({
        msg,
        attachments,
        approvalMeta: null,
        displayContent: msg.content,
        thoughts: pendingThoughts,
      });
      pendingThoughts = [];
      continue;
    }

    // User / system messages
    const attachments: AttachmentMeta[] = safeJsonParse<AttachmentMeta[]>(msg.attachments, []);
    const approvalMeta = msg.role === "system" ? extractApprovalMeta(msg.content) : null;
    const displayContent = approvalMeta ? stripApprovalMeta(msg.content) : msg.content;
    pendingThoughts = [];
    result.push({ msg, attachments, approvalMeta, displayContent, thoughts: [] });
  }

  // Streaming placeholders for real-time progress
  if (pendingThoughts.length > 0 && loading) {
    result.push({
      msg: { id: -1, thread_id: "", role: "assistant", content: null, tool_calls: null, tool_results: null, attachments: null, created_at: null },
      attachments: [],
      approvalMeta: null,
      displayContent: null,
      thoughts: pendingThoughts,
    });
  } else if (loading && thinkingSteps.length > 0 && !result.some((r) => r.msg.role === "assistant")) {
    result.push({
      msg: { id: -1, thread_id: "", role: "assistant", content: null, tool_calls: null, tool_results: null, attachments: null, created_at: null },
      attachments: [],
      approvalMeta: null,
      displayContent: null,
      thoughts: [],
    });
  }

  return result;
}
