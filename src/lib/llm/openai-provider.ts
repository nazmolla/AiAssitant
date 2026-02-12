import OpenAI from "openai";
import type { ChatProvider, ChatMessage, ChatResponse, ToolDefinition } from "./types";

/**
 * Azure OpenAI / OpenAI chat provider using the official `openai` SDK.
 */
export class OpenAIChatProvider implements ChatProvider {
  private client: OpenAI;
  private model: string;

  constructor() {
    if (process.env.AZURE_OPENAI_ENDPOINT) {
      this.client = new OpenAI({
        apiKey: process.env.AZURE_OPENAI_API_KEY!,
        baseURL: `${process.env.AZURE_OPENAI_ENDPOINT}/openai/deployments/${process.env.AZURE_OPENAI_DEPLOYMENT}`,
        defaultQuery: { "api-version": "2024-08-01-preview" },
        defaultHeaders: { "api-key": process.env.AZURE_OPENAI_API_KEY! },
      });
      this.model = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o";
    } else {
      this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
      this.model = "gpt-4o";
    }
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
