import { getDefaultLlmProvider, type LlmProviderRecord } from "@/lib/db";
import type { ChatProvider } from "./types";
import { OpenAIChatProvider } from "./openai-provider";
import { AnthropicChatProvider } from "./anthropic-provider";

export type { ChatProvider, ChatMessage, ChatResponse, ToolDefinition, ToolCall, ContentPart } from "./types";

/**
 * Factory: returns the appropriate ChatProvider based on available env vars.
 * Priority: Azure OpenAI > OpenAI > Anthropic.
 */
export function createChatProvider(): ChatProvider {
  const defaultProvider = getDefaultLlmProvider("chat");
  if (defaultProvider) {
    return buildProviderFromRecord(defaultProvider);
  }

  throw new Error(
    "[Nexus] No LLM provider configured. Add one in Settings → LLM Providers."
  );
}

function buildProviderFromRecord(record: LlmProviderRecord): ChatProvider {
  const config = parseConfig(record);

  switch (record.provider_type) {
    case "azure-openai": {
      const apiKey = config.apiKey as string | undefined;
      const endpoint = config.endpoint as string | undefined;
      const deployment = config.deployment as string | undefined;
      const apiVersion = config.apiVersion as string | undefined;
      assertConfig(apiKey && endpoint && deployment, `Azure OpenAI config for ${record.label} is incomplete.`);
      return new OpenAIChatProvider({
        variant: "azure",
        apiKey,
        endpoint,
        deployment,
        apiVersion,
      });
    }
    case "openai": {
      const apiKey = config.apiKey as string | undefined;
      const model = config.model as string | undefined;
      const baseURL = config.baseURL as string | undefined;
      assertConfig(apiKey, `OpenAI config for ${record.label} is missing an API key.`);
      return new OpenAIChatProvider({
        variant: "openai",
        apiKey,
        model,
        baseURL,
      });
    }
    case "anthropic": {
      const apiKey = config.apiKey as string | undefined;
      const model = config.model as string | undefined;
      assertConfig(apiKey, `Anthropic config for ${record.label} is missing an API key.`);
      return new AnthropicChatProvider({ apiKey, model });
    }
    default:
      throw new Error(`[Nexus] Unknown LLM provider type: ${record.provider_type}`);
  }
}

function parseConfig(record: LlmProviderRecord): Record<string, unknown> {
  try {
    return record.config_json ? JSON.parse(record.config_json) : {};
  } catch (err) {
    throw new Error(`[Nexus] Failed to parse LLM config for ${record.label}: ${(err as Error).message}`);
  }
}

function assertConfig(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`[Nexus] ${message}`);
  }
}
