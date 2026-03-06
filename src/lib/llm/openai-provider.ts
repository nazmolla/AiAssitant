import OpenAI from "openai";
import type { ChatProvider, ChatMessage, ChatResponse, ToolDefinition, ContentPart, ChatRequestOptions } from "./types";

export type OpenAIProviderOptions =
  | {
      variant: "azure";
      apiKey: string;
      endpoint: string;
      deployment: string;
      apiVersion?: string;
      disableThinking?: boolean;
    }
  | {
      variant: "openai";
      apiKey: string;
      model?: string;
      baseURL?: string;
      disableThinking?: boolean;
    };

/**
 * Azure OpenAI / OpenAI chat provider using the official `openai` SDK.
 */
export class OpenAIChatProvider implements ChatProvider {
  private client: OpenAI;
  private model: string;
  private disableThinkingByDefault: boolean;

  constructor(options: OpenAIProviderOptions) {
    const configured = this.fromOptions(options);
    this.client = configured.client;
    this.model = configured.model;
    this.disableThinkingByDefault = !!options.disableThinking;
  }

  private fromOptions(options: OpenAIProviderOptions): { client: OpenAI; model: string } {
    if (options.variant === "azure") {
      const endpoint = options.endpoint.replace(/\/$/, "");
      const model = options.deployment;
      const client = new OpenAI({
        apiKey: options.apiKey,
        baseURL: `${endpoint}/openai/deployments/${options.deployment}`,
        defaultQuery: { "api-version": options.apiVersion || "2024-08-01-preview" },
        defaultHeaders: { "api-key": options.apiKey },
        timeout: 15_000,
        maxRetries: 1,
      });
      return { client, model };
    }

    const client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      timeout: 15_000,
      maxRetries: 1,
    });
    const model = options.model || "gpt-4o";
    return { client, model };
  }

  async chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    systemPrompt?: string,
    onToken?: (token: string) => void | Promise<void>,
    requestOptions?: ChatRequestOptions
  ): Promise<ChatResponse> {
    const oaiMessages: OpenAI.ChatCompletionMessageParam[] = [];

    if (systemPrompt) {
      oaiMessages.push({ role: "system", content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === "tool") {
        oaiMessages.push({
          role: "tool",
          content: msg.content,
          tool_call_id: msg.tool_call_id || "",
        });
      } else if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
        // Assistant message with tool calls — must include them for proper round-tripping
        oaiMessages.push({
          role: "assistant",
          content: msg.content || null,
          tool_calls: msg.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        });
      } else if (msg.contentParts && msg.contentParts.length > 0 && msg.role === "user") {
        // Multimodal user message
        const parts: OpenAI.ChatCompletionContentPart[] = msg.contentParts.map((p) =>
          toOpenAIPart(p)
        );
        oaiMessages.push({ role: "user", content: parts });
      } else {
        oaiMessages.push({
          role: msg.role as "user" | "assistant" | "system",
          content: msg.content,
        });
      }
    }

    const oaiTools: OpenAI.ChatCompletionTool[] | undefined = tools?.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema as Record<string, unknown>,
      },
    }));

    const disableThinking = this.disableThinkingByDefault || !!requestOptions?.disableThinking;

    // Streaming mode: yield tokens as they arrive for real-time display
    if (onToken) {
      const streamParams: Record<string, unknown> = {
        model: this.model,
        messages: oaiMessages,
        tools: oaiTools,
        tool_choice: tools && tools.length > 0 ? "auto" : undefined,
        stream: true,
      };
      if (disableThinking) streamParams.think = false;

      let stream;
      try {
        stream = await this.client.chat.completions.create(streamParams as unknown as OpenAI.ChatCompletionCreateParamsStreaming);
      } catch (err) {
        if (disableThinking && isUnsupportedThinkParamError(err)) {
          const retryParams = { ...streamParams };
          delete retryParams.think;
          stream = await this.client.chat.completions.create(retryParams as unknown as OpenAI.ChatCompletionCreateParamsStreaming);
        } else {
          throw err;
        }
      }

      let content = "";
      const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>();
      let finishReason = "stop";

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          content += delta.content;
          await onToken(delta.content);
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = toolCallsMap.get(tc.index);
            if (existing) {
              if (tc.function?.arguments) {
                existing.arguments += tc.function.arguments;
              }
            } else {
              toolCallsMap.set(tc.index, {
                id: tc.id || "",
                name: tc.function?.name || "",
                arguments: tc.function?.arguments || "",
              });
            }
          }
        }

        if (chunk.choices[0]?.finish_reason) {
          finishReason = chunk.choices[0].finish_reason;
        }
      }

      const toolCalls = Array.from(toolCallsMap.values()).map((tc) => ({
        id: tc.id,
        name: tc.name,
        arguments: JSON.parse(tc.arguments || "{}"),
      }));

      return {
        content: content || null,
        toolCalls,
        finishReason,
      };
    }

    // Non-streaming mode (fallback)
    const requestParams: Record<string, unknown> = {
      model: this.model,
      messages: oaiMessages,
      tools: oaiTools,
      tool_choice: tools && tools.length > 0 ? "auto" : undefined,
    };
    if (disableThinking) requestParams.think = false;

    let response;
    try {
      response = await this.client.chat.completions.create(requestParams as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming);
    } catch (err) {
      if (disableThinking && isUnsupportedThinkParamError(err)) {
        const retryParams = { ...requestParams };
        delete retryParams.think;
        response = await this.client.chat.completions.create(retryParams as unknown as OpenAI.ChatCompletionCreateParamsNonStreaming);
      } else {
        throw err;
      }
    }

    const choice = response.choices[0];
    const toolCalls =
      choice.message.tool_calls
        ?.filter((tc): tc is OpenAI.ChatCompletionMessageFunctionToolCall => tc.type === "function")
        .map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments || "{}"),
        })) || [];

    return {
      content: choice.message.content,
      toolCalls,
      finishReason: choice.finish_reason || "stop",
    };
  }
}

function isUnsupportedThinkParamError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("unknown") && msg.includes("think") ||
    msg.includes("invalid") && msg.includes("think") ||
    msg.includes("unsupported") && msg.includes("think")
  );
}

function toOpenAIPart(part: ContentPart): OpenAI.ChatCompletionContentPart {
  if (part.type === "text") {
    return { type: "text", text: part.text };
  }
  if (part.type === "image_url") {
    return {
      type: "image_url",
      image_url: { url: part.image_url.url, detail: part.image_url.detail || "auto" },
    };
  }
  // For files (PDFs, etc.) — send as text description since the OpenAI SDK
  // image_url supports images; documents are described textually.
  return {
    type: "text",
    text: `[Attached file: ${part.file.filename} (${part.file.mimeType})]`,
  };
}
