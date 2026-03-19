/**
 * Knowledge persistence from conversation turns.
 * Extracted from loop.ts for maintainability.
 */

import { getThread, addLog } from "@/lib/db";
import { ingestKnowledgeFromText } from "@/lib/knowledge";
import { createLogger } from "@/lib/logging/logger";

const log = createLogger("agent.knowledge-persistence");

export async function persistKnowledgeFromTurn(
  threadId: string,
  snippets: string[],
  userId?: string
): Promise<void> {
  const t0 = Date.now();
  log.enter("persistKnowledgeFromTurn", { threadId, snippetCount: snippets.length });
  const payload = snippets.join("\n\n").slice(0, 8000);
  if (!payload.trim()) {
    log.exit("persistKnowledgeFromTurn", { skipped: true }, Date.now() - t0);
    return;
  }

  // Determine source type from typed thread metadata.
  let source = `chat:${threadId}`;
  try {
    const thread = getThread(threadId);
    if (thread?.thread_type === "proactive" || thread?.thread_type === "scheduled") {
      source = `proactive:${threadId}`;
    }
  } catch (err) {
    // Fall back to chat source if thread lookup fails
    log.error("Thread lookup failed in persistKnowledgeFromTurn", { threadId }, err);
  }

  await ingestKnowledgeFromText({
    source,
    text: payload,
    contextHint: "Extract durable user knowledge from this conversation turn.",
    userId,
  });
  log.exit("persistKnowledgeFromTurn", { source }, Date.now() - t0);
}
