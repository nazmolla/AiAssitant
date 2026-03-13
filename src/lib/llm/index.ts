import { getDefaultLlmProvider, type LlmProviderRecord } from "@/lib/db";
import type { ChatProvider } from "./types";
import { OpenAIChatProvider } from "./openai-provider";
import { AnthropicChatProvider } from "./anthropic-provider";
import { getCachedProviderByRecord } from "./orchestrator";
import { ConfigurationError } from "@/lib/errors";

export type { ChatProvider, ChatMessage, ChatResponse, ToolDefinition, ToolCall, ContentPart } from "./types";
export { selectProvider, selectBackgroundProvider, selectFallbackProvider, selectProviderForWorker, classifyTask, type TaskType, type RoutingTier, type OrchestratorResult, type WorkerProviderInfo } from "./orchestrator";

/**
 * Factory: returns the appropriate ChatProvider based on available env vars.
 * Priority: Azure OpenAI > OpenAI > Anthropic.
 */
export function createChatProvider(): ChatProvider {
  const defaultProvider = getDefaultLlmProvider("chat");
  if (defaultProvider) {
    return buildProviderFromRecord(defaultProvider);
  }

  throw new ConfigurationError(
    "No LLM provider configured. Add one in Settings → LLM Providers."
  );
}

function buildProviderFromRecord(record: LlmProviderRecord): ChatProvider {
  const config = parseConfig(record);
  return getCachedProviderByRecord(record, config, () => buildProviderUncached(record, config));
}

function buildProviderUncached(record: LlmProviderRecord, config: Record<string, unknown>): ChatProvider {
  switch (record.provider_type) {
    case "azure-openai": {
      const apiKey = config.apiKey as string | undefined;
      const endpoint = config.endpoint as string | undefined;
      const deployment = config.deployment as string | undefined;
      const apiVersion = config.apiVersion as string | undefined;
      const disableThinking = config.disableThinking === true;
      assertConfig(apiKey && endpoint && deployment, `Azure OpenAI config for ${record.label} is incomplete.`);
      return new OpenAIChatProvider({
        variant: "azure",
        apiKey,
        endpoint,
        deployment,
        apiVersion,
        disableThinking,
      });
    }
    case "openai": {
      const apiKey = config.apiKey as string | undefined;
      const model = config.model as string | undefined;
      const baseURL = config.baseURL as string | undefined;
      const disableThinking = config.disableThinking === true;
      assertConfig(apiKey, `OpenAI config for ${record.label} is missing an API key.`);
      return new OpenAIChatProvider({
        variant: "openai",
        apiKey,
        model,
        baseURL,
        disableThinking,
      });
    }
    case "anthropic": {
      const apiKey = config.apiKey as string | undefined;
      const model = config.model as string | undefined;
      assertConfig(apiKey, `Anthropic config for ${record.label} is missing an API key.`);
      return new AnthropicChatProvider({ apiKey, model });
    }
    case "litellm": {
      const apiKey = (config.apiKey as string | undefined) || "no-key-required";
      const model = config.model as string | undefined;
      let baseURL = config.baseURL as string | undefined;
      const disableThinking = config.disableThinking === true;
      assertConfig(baseURL, `LiteLLM config for ${record.label} is missing a Base URL.`);
      assertConfig(model, `LiteLLM config for ${record.label} is missing a Model name.`);
      // Ollama serves OpenAI-compatible API at /v1 — normalize if not present
      if (baseURL && !baseURL.endsWith("/v1") && !baseURL.endsWith("/v1/")) {
        baseURL = baseURL.replace(/\/$/, "") + "/v1";
      }
      return new OpenAIChatProvider({
        variant: "openai",
        apiKey,
        model,
        baseURL,
        disableThinking,
      });
    }
    default:
      throw new ConfigurationError(`Unknown LLM provider type: ${record.provider_type}`, { providerType: record.provider_type });
  }
}

function parseConfig(record: LlmProviderRecord): Record<string, unknown> {
  try {
    return record.config_json ? JSON.parse(record.config_json) : {};
  } catch (err) {
    throw new ConfigurationError(`Failed to parse LLM config for ${record.label}: ${(err as Error).message}`, { label: record.label });
  }
}

function assertConfig(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new ConfigurationError(message);
  }
}
