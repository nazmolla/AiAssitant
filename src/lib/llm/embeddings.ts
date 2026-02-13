import OpenAI from "openai";
import { getDefaultLlmProvider } from "@/lib/db";

/**
 * Generates embeddings using the configured default embedding provider,
 * falling back to env vars when no DB provider is set.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];

  // 1. Try DB-configured embedding provider
  const dbProvider = getDefaultLlmProvider("embedding");
  if (dbProvider) {
    return generateFromRecord(dbProvider, trimmed);
  }

  // 2. Fallback to env vars
  if (process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_API_KEY) {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT.replace(/\/$/, "");
    const deployment = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || process.env.AZURE_OPENAI_DEPLOYMENT;
    if (!deployment) {
      throw new Error("[Nexus] Missing AZURE_OPENAI_EMBEDDING_DEPLOYMENT for embedding generation.");
    }
    const client = new OpenAI({
      apiKey: process.env.AZURE_OPENAI_API_KEY,
      baseURL: `${endpoint}/openai/deployments/${deployment}`,
      defaultQuery: { "api-version": process.env.AZURE_OPENAI_API_VERSION || "2024-08-01-preview" },
      defaultHeaders: { "api-key": process.env.AZURE_OPENAI_API_KEY },
    });
    const response = await client.embeddings.create({ model: deployment, input: trimmed });
    return response.data[0]?.embedding || [];
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("[Nexus] No embedding provider configured. Add one in the Configurations tab or set env vars.");
  }

  const model = process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-large";
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const response = await client.embeddings.create({ model, input: trimmed });
  return response.data[0]?.embedding || [];
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
