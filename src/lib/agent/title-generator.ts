/**
 * Thread title auto-generation for the Nexus agent.
 * Extracted from loop.ts for maintainability.
 */

import {
  getThread,
  updateThreadTitle,
  addLog,
} from "@/lib/db";
import { selectBackgroundProvider } from "@/lib/llm";
import { buildThreadTitleUserPrompt, THREAD_TITLE_SYSTEM_PROMPT } from "@/lib/prompts";

/**
 * Auto-generate a short descriptive thread title from the first user message + response.
 * Only updates if the thread still has the default "New Thread" title.
 */
export async function maybeUpdateThreadTitle(
  threadId: string,
  userMessage: string,
  assistantResponse: string
): Promise<void> {
  try {
    const thread = getThread(threadId);
    if (!thread || thread.title !== "New Thread") return;

    // Generate a short title from the user's first message
    const msg = userMessage.trim().slice(0, 200);
    let title: string;

    // Try to use the LLM to generate a concise title (use background provider for cost savings)
    try {
      const bgResult = selectBackgroundProvider();
      const titleProvider = bgResult.provider;
      const titleResponse = await titleProvider.chat(
        [
          {
            role: "user",
            content: buildThreadTitleUserPrompt(msg, assistantResponse),
          },
        ],
        undefined,
        THREAD_TITLE_SYSTEM_PROMPT
      );
      title = (titleResponse.content || "").replace(/^["']|["']$/g, "").replace(/\.+$/, "").trim();
    } catch (err) {
      addLog({
        level: "verbose",
        source: "agent",
        message: "LLM thread title generation failed; using fallback title.",
        metadata: JSON.stringify({ threadId, error: err instanceof Error ? err.message : String(err) }),
      });
      // Fallback: extract from the user message
      title = msg;
    }

    // Ensure title is reasonable length
    if (!title || title.length < 2) {
      title = msg;
    }
    if (title.length > 60) {
      title = title.slice(0, 57) + "...";
    }

    updateThreadTitle(threadId, title);
  } catch (err) {
    // Non-critical — just log and move on
    addLog({
      level: "warn",
      source: "agent",
      message: `Failed to auto-title thread: ${err}`,
      metadata: JSON.stringify({ threadId }),
    });
  }
}
