import type { ChatProvider } from "./types";
import { OpenAIChatProvider } from "./openai-provider";
import { AnthropicChatProvider } from "./anthropic-provider";

export type { ChatProvider, ChatMessage, ChatResponse, ToolDefinition, ToolCall } from "./types";

/**
 * Factory: returns the appropriate ChatProvider based on available env vars.
 * Priority: Azure OpenAI > OpenAI > Anthropic.
 */
export function createChatProvider(): ChatProvider {
  if (process.env.AZURE_OPENAI_API_KEY || process.env.OPENAI_API_KEY) {
    return new OpenAIChatProvider();
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return new AnthropicChatProvider();
  }
  throw new Error(
    "[Nexus] No LLM API key configured. Set AZURE_OPENAI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY."
  );
}
