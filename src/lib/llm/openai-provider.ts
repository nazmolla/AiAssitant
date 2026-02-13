import OpenAI from "openai";
import type { ChatProvider, ChatMessage, ChatResponse, ToolDefinition, ContentPart } from "./types";

export type OpenAIProviderOptions =
  | {
      variant: "azure";
      apiKey: string;
      endpoint: string;
      deployment: string;
      apiVersion?: string;
    }
  | {
      variant: "openai";
      apiKey: string;
      model?: string;
      baseURL?: string;
    };

/**
 * Azure OpenAI / OpenAI chat provider using the official `openai` SDK.
 */
export class OpenAIChatProvider implements ChatProvider {
  private client: OpenAI;
  private model: string;

  constructor(options?: OpenAIProviderOptions) {
    if (options) {
      const configured = this.fromOptions(options);
      this.client = configured.client;
      this.model = configured.model;
      return;
    }

    if (process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_API_KEY) {
      const endpoint = process.env.AZURE_OPENAI_ENDPOINT.replace(/\/$/, "");
      const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o";
      this.client = new OpenAI({
        apiKey: process.env.AZURE_OPENAI_API_KEY,
        baseURL: `${endpoint}/openai/deployments/${deployment}`,
        defaultQuery: { "api-version": process.env.AZURE_OPENAI_API_VERSION || "2024-08-01-preview" },
        defaultHeaders: { "api-key": process.env.AZURE_OPENAI_API_KEY },
      });
      this.model = deployment;
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      throw new Error("[Nexus] Missing OpenAI credentials.");
    }

    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.model = process.env.OPENAI_MODEL || "gpt-4o";
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
      });
      return { client, model };
    }

    const client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    });
    const model = options.model || "gpt-4o";
    return { client, model };
  }

  async chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    systemPrompt?: string
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

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: oaiMessages,
      tools: oaiTools,
      tool_choice: tools && tools.length > 0 ? "auto" : undefined,
    });

    const choice = response.choices[0];
    const toolCalls =
      choice.message.tool_calls?.map((tc) => ({
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
