/**
 * Tool result processing — handles screenshot detection, attachment
 * collection, result truncation, and DB persistence for tool outputs.
 *
 * Extracted from loop.ts for SRP compliance.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { ToolCall, ChatMessage } from "@/lib/llm";
import { addMessage, addAttachment, addLog, type Message, type AttachmentMeta } from "@/lib/db";
import { isUntrustedToolOutput } from "./system-prompt";
import { TOOL_RESULT_TRUNCATION_LIMIT } from "@/lib/constants";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("agent.tool-result-processor");

export interface ProcessedToolResult {
  /**
   * Screenshot attachments only — carried forward to the final assistant
   * message so they render inline in the UI. Generic file attachments are
   * already saved on the tool message and must NOT be added again here.
   */
  attachments: AttachmentMeta[];
  /** Content injected into the LLM chat (may differ from DB content). */
  llmContent: string;
}

/**
 * Detect and collect screenshot attachments from a screenshot tool result.
 * Handles builtin.browser_screenshot and any MCP tool whose result contains
 * a screenshotPath / relativePath field (generic detection).
 */
function collectScreenshotAttachments(
  toolCall: ToolCall,
  resultObj: Record<string, unknown> | undefined,
  threadId: string
): { attachments: AttachmentMeta[]; llmOverride: string | null } {
  const isBuiltinScreenshot = toolCall.name === "builtin.browser_screenshot";
  const hasScreenshotField =
    typeof resultObj?.screenshotPath === "string" ||
    typeof resultObj?.relativePath === "string";

  // Only process if it's a builtin screenshot tool OR any tool that returns
  // a screenshot path field (MCP screenshot tools use the same field names).
  if (!isBuiltinScreenshot && !hasScreenshotField) {
    return { attachments: [], llmOverride: null };
  }

  const rawScreenshotPath =
    typeof resultObj?.screenshotPath === "string" ? (resultObj.screenshotPath as string) : "";
  const normalizedScreenshotPath = rawScreenshotPath.replace(/^sandbox:\//, "");
  const relPathRaw =
    typeof resultObj?.relativePath === "string" ? (resultObj.relativePath as string) : rawScreenshotPath;
  const relPathNormalized = relPathRaw.replace(/^sandbox:\//, "");

  let storagePath = relPathNormalized || normalizedScreenshotPath;
  const dataIdx = storagePath.indexOf("data/");
  if (dataIdx >= 0) {
    storagePath = storagePath.slice(dataIdx + "data/".length);
  }
  storagePath = storagePath.replace(/^data\//, "").replace(/^\/+/, "");
  if (!storagePath && relPathNormalized.includes("screenshots")) {
    const idx = relPathNormalized.lastIndexOf("screenshots/");
    storagePath = relPathNormalized.slice(idx);
  }
  if (!storagePath && normalizedScreenshotPath.includes("screenshots")) {
    const idx = normalizedScreenshotPath.lastIndexOf("screenshots/");
    storagePath = normalizedScreenshotPath.slice(idx);
  }

  let sizeBytes = 0;
  for (const candidate of [normalizedScreenshotPath, rawScreenshotPath]) {
    if (!candidate) continue;
    try {
      const stats = fs.statSync(candidate);
      sizeBytes = stats.size;
      break;
    } catch {
      // Try next candidate
    }
  }

  const attachments: AttachmentMeta[] = [];
  if (storagePath) {
    const filename =
      path.basename(normalizedScreenshotPath || rawScreenshotPath) || `screenshot-${Date.now()}.png`;
    attachments.push({
      id: crypto.randomUUID(),
      filename,
      mimeType: "image/png",
      sizeBytes,
      storagePath,
    });
  } else {
    addLog({
      level: "warn",
      source: "agent",
      message: "browser_screenshot result missing relative path; screenshot will not render inline.",
      metadata: JSON.stringify({ threadId, rawResult: resultObj }),
    });
    log.warning("browser_screenshot result missing relative path; screenshot will not render inline.", { threadId });
  }

  const llmOverride = JSON.stringify({
    status: "screenshot_taken",
    note: "Screenshot attached inline. Do NOT output any file path, URL, or markdown image. If you reference it, just say 'Here is the screenshot.'",
  });

  return { attachments, llmOverride };
}

/**
 * Collect generic file attachments from a tool result's `attachments` array.
 */
function collectGenericAttachments(resultObj: Record<string, unknown> | undefined): AttachmentMeta[] {
  const rawToolAttachments = resultObj?.attachments;
  if (!Array.isArray(rawToolAttachments)) return [];

  const collected: AttachmentMeta[] = [];
  for (const rawAtt of rawToolAttachments) {
    if (!rawAtt || typeof rawAtt !== "object") continue;
    const att = rawAtt as AttachmentMeta;
    if (
      typeof att.id === "string" &&
      typeof att.filename === "string" &&
      typeof att.mimeType === "string" &&
      typeof att.sizeBytes === "number" &&
      typeof att.storagePath === "string"
    ) {
      collected.push(att);
    }
  }
  return collected;
}

/**
 * Process a successfully executed tool result: truncate, detect attachments,
 * save to DB, and return the content for the LLM chat context.
 */
export function processExecutedToolResult(
  toolCall: ToolCall,
  result: unknown,
  threadId: string,
  onMessage?: (msg: Message) => void
): ProcessedToolResult {
  const t0 = Date.now();
  log.enter("processExecutedToolResult", { threadId, toolName: toolCall.name });
  const toolResultRaw = JSON.stringify(result);
  const toolResult =
    toolResultRaw.length > TOOL_RESULT_TRUNCATION_LIMIT
      ? toolResultRaw.slice(0, TOOL_RESULT_TRUNCATION_LIMIT) + "\n... [truncated]"
      : toolResultRaw;

  const resultObj = result as Record<string, unknown> | undefined;

  // Collect screenshot attachments (carried to final assistant message for inline rendering)
  const screenshotResult = collectScreenshotAttachments(toolCall, resultObj, threadId);
  // Collect generic attachments from tool result (saved only to the tool message — not the final assistant message)
  const genericAttachments = collectGenericAttachments(resultObj);
  const allAttachments = [...screenshotResult.attachments, ...genericAttachments];
  const llmToolResult = screenshotResult.llmOverride ?? toolResult;

  const toolAttachmentsJson = allAttachments.length > 0 ? JSON.stringify(allAttachments) : null;

  // Persist to DB
  const savedMsg = addMessage({
    thread_id: threadId,
    role: "tool",
    content: llmToolResult,
    tool_calls: null,
    tool_results: JSON.stringify({ tool_call_id: toolCall.id, name: toolCall.name, result }),
    attachments: toolAttachmentsJson,
  });
  onMessage?.(savedMsg);

  // Persist attachment records in DB
  if (toolAttachmentsJson) {
    const atts: AttachmentMeta[] = JSON.parse(toolAttachmentsJson);
    for (const att of atts) {
      addAttachment({
        id: att.id,
        thread_id: threadId,
        message_id: savedMsg.id,
        filename: att.filename,
        mime_type: att.mimeType,
        size_bytes: att.sizeBytes,
        storage_path: att.storagePath,
      });
    }
  }

  // Wrap untrusted external content with injection boundary markers
  const llmContent = isUntrustedToolOutput(toolCall.name)
    ? `<untrusted_external_content source="${toolCall.name}">\n${llmToolResult}\n</untrusted_external_content>`
    : llmToolResult;

  log.exit("processExecutedToolResult", { toolName: toolCall.name, attachmentCount: allAttachments.length }, Date.now() - t0);
  // Return only screenshot attachments so loop.ts can add them to the final assistant message.
  // Generic file attachments are already persisted on the tool message above.
  return { attachments: screenshotResult.attachments, llmContent };
}

/**
 * Process a failed tool result: sanitize and persist the error.
 */
export function processFailedToolResult(
  toolCall: ToolCall,
  error: string | undefined,
  threadId: string,
  onMessage?: (msg: Message) => void
): string {
  log.enter("processFailedToolResult", { threadId, toolName: toolCall.name });
  const sanitizedError = (error || "Unknown error")
    .split("\n")[0]
    .replace(/[A-Z]:[\\\/][^\s]+/g, "[path]")
    .replace(/\/home\/[^\s]+/g, "[path]")
    .slice(0, 200);
  const errorContent = `[ERROR] Tool "${toolCall.name}" failed: ${sanitizedError}`;

  const savedError = addMessage({
    thread_id: threadId,
    role: "tool",
    content: errorContent,
    tool_calls: null,
    tool_results: JSON.stringify({ tool_call_id: toolCall.id, name: toolCall.name, error }),
    attachments: null,
  });
  onMessage?.(savedError);

  log.error("Tool execution failed", { threadId, toolName: toolCall.name, sanitizedError });
  return errorContent;
}
