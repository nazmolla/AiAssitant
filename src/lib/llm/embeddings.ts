import OpenAI from "openai";
import { getDefaultLlmProvider } from "@/lib/db";

/**
 * Generates embeddings using the configured default embedding provider,
 * falling back to env vars when no DB provider is set.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const dbProvider = getDefaultLlmProvider("embedding");
  if (dbProvider) {
    return generateFromRecord(dbProvider, trimmed);
  }

  throw new Error("[Nexus] No embedding provider configured. Add one in Settings → LLM Providers.");
}

function generateFromRecord(
  record: { provider_type: string; config_json: string; label: string },
  text: string
): Promise<number[]> {
  const config = JSON.parse(record.config_json || "{}");

  if (record.provider_type === "azure-openai") {
    const apiKey = config.apiKey as string;
    const endpoint = (config.endpoint as string).replace(/\/$/, "");
    const deployment = config.deployment as string;
    if (!apiKey || !endpoint || !deployment) {
      throw new Error(`[Nexus] Azure OpenAI embedding config for "${record.label}" is incomplete.`);
    }
    const client = new OpenAI({
      apiKey,
      baseURL: `${endpoint}/openai/deployments/${deployment}`,
      defaultQuery: { "api-version": (config.apiVersion as string) || "2024-08-01-preview" },
      defaultHeaders: { "api-key": apiKey },
    });
    return client.embeddings
      .create({ model: deployment, input: text })
      .then((r) => r.data[0]?.embedding || []);
  }

  if (record.provider_type === "openai") {
    const apiKey = config.apiKey as string;
    if (!apiKey) {
      throw new Error(`[Nexus] OpenAI embedding config for "${record.label}" is missing an API key.`);
    }
    const client = new OpenAI({
      apiKey,
      baseURL: config.baseURL as string | undefined,
    });
    const model = (config.model as string) || "text-embedding-3-large";
    return client.embeddings
      .create({ model, input: text })
      .then((r) => r.data[0]?.embedding || []);
  }

  throw new Error(`[Nexus] Provider type "${record.provider_type}" does not support embeddings.`);
}
