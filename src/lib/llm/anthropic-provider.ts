import Anthropic from "@anthropic-ai/sdk";
import type { ChatProvider, ChatMessage, ChatResponse, ToolDefinition, ContentPart, ChatRequestOptions } from "./types";

export interface AnthropicProviderOptions {
  apiKey?: string;
  model?: string;
}

/**
 * Anthropic chat provider using the official `@anthropic-ai/sdk`.
 */
export class AnthropicChatProvider implements ChatProvider {
  private client: Anthropic;
  private model: string;

  constructor(options: AnthropicProviderOptions) {
    const apiKey = options.apiKey;
    if (!apiKey) {
      throw new Error("[Nexus] Missing Anthropic API key.");
    }

    this.client = new Anthropic({ apiKey });
    this.model = options.model || "claude-sonnet-4-20250514";
  }

  async chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    systemPrompt?: string,
    onToken?: (token: string) => void | Promise<void>,
    _requestOptions?: ChatRequestOptions
  ): Promise<ChatResponse> {
    const anthropicMessages: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === "system") continue; // handled separately
      if (msg.role === "tool") {
        anthropicMessages.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.tool_call_id || "",
              content: msg.content,
            },
          ],
        });
      } else if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
        // Assistant message with tool calls — must include tool_use blocks
        const blocks: (Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam)[] = [];
        if (msg.content) {
          blocks.push({ type: "text", text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: tc.arguments,
          });
        }
        anthropicMessages.push({ role: "assistant", content: blocks });
      } else if (msg.contentParts && msg.contentParts.length > 0 && msg.role === "user") {
        // Multimodal user message
        const parts = msg.contentParts.map((p) =>
          toAnthropicPart(p)
        );
        anthropicMessages.push({ role: "user", content: parts as Anthropic.MessageParam["content"] });
      } else {
        anthropicMessages.push({
          role: msg.role === "assistant" ? "assistant" : "user",
          content: msg.content,
        });
      }
    }

    const anthropicTools: Anthropic.Tool[] | undefined = tools?.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
    }));

    // Streaming mode: yield tokens as they arrive for real-time display
    if (onToken) {
      const stream = this.client.messages.stream({
        model: this.model,
        max_tokens: 4096,
        system: systemPrompt || undefined,
        messages: anthropicMessages,
        tools: anthropicTools,
      });

      // Use async iteration for proper backpressure — await each onToken
      // so the write flushes to the HTTP response before consuming the next chunk.
      for await (const event of stream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          await onToken(event.delta.text);
        }
      }

      // Get the accumulated final message (stream already fully consumed)
      const finalMessage = await stream.finalMessage();

      let content: string | null = null;
      const toolCalls: ChatResponse["toolCalls"] = [];

      for (const block of finalMessage.content) {
        if (block.type === "text") {
          content = block.text;
        } else if (block.type === "tool_use") {
          toolCalls.push({
            id: block.id,
            name: block.name,
            arguments: block.input as Record<string, unknown>,
          });
        }
      }

      return {
        content,
        toolCalls,
        finishReason: finalMessage.stop_reason || "end_turn",
      };
    }

    // Non-streaming mode (fallback)
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt || undefined,
      messages: anthropicMessages,
      tools: anthropicTools,
    });

    let content: string | null = null;
    const toolCalls: ChatResponse["toolCalls"] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        content = block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content,
      toolCalls,
      finishReason: response.stop_reason || "end_turn",
    };
  }
}

function toAnthropicPart(part: ContentPart): Anthropic.ImageBlockParam | Anthropic.TextBlockParam {
  if (part.type === "text") {
    return { type: "text", text: part.text };
  }
  if (part.type === "image_url") {
    // Anthropic expects base64 source; the URL may be a data URI or http URL.
    const url = part.image_url.url;
    if (url.startsWith("data:")) {
      const match = url.match(/^data:(image\/[^;]+);base64,(.+)$/);
      if (match) {
        return {
          type: "image",
          source: {
            type: "base64",
            media_type: match[1] as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: match[2],
          },
        };
      }
    }
    // Fallback: send as URL source
    return {
      type: "image",
      source: { type: "url" as "base64", media_type: "image/jpeg", data: url },
    };
  }
  // Documents / videos — describe as text
  return {
    type: "text",
    text: `[Attached file: ${part.file.filename} (${part.file.mimeType})]`,
  };
}
