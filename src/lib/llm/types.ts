/**
 * Nexus Intelligence Adapter
 *
 * A unified ChatProvider interface that dynamically switches between
 * Azure OpenAI, OpenAI, and Anthropic SDKs. No LangChain.
 */

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }
  | { type: "file"; file: { url: string; mimeType: string; filename: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  contentParts?: ContentPart[];        // multimodal content — takes precedence over `content` when present
  tool_call_id?: string;
  tool_calls?: ToolCall[];             // tool calls made by the assistant (needed for proper round-tripping)
  name?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
}

export interface ChatRequestOptions {
  disableThinking?: boolean;
}

export interface ChatProvider {
  chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    systemPrompt?: string,
    onToken?: (token: string) => void | Promise<void>,
    requestOptions?: ChatRequestOptions
  ): Promise<ChatResponse>;
}
