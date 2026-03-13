/**
 * Knowledge persistence from conversation turns.
 * Extracted from loop.ts for maintainability.
 */

import { getThread, addLog } from "@/lib/db";
import { ingestKnowledgeFromText } from "@/lib/knowledge";

export async function persistKnowledgeFromTurn(
  threadId: string,
  snippets: string[],
  userId?: string
): Promise<void> {
  const payload = snippets.join("\n\n").slice(0, 8000);
  if (!payload.trim()) return;

  // Determine source type from typed thread metadata.
  let source = `chat:${threadId}`;
  try {
    const thread = getThread(threadId);
    if (thread?.thread_type === "proactive" || thread?.thread_type === "scheduled") {
      source = `proactive:${threadId}`;
    }
  } catch {
    // Fall back to chat source if thread lookup fails
  }

  await ingestKnowledgeFromText({
    source,
    text: payload,
    contextHint: "Extract durable user knowledge from this conversation turn.",
    userId,
  });
}
