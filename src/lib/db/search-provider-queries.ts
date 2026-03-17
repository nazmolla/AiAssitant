import { decryptField, encryptField } from "./crypto";
import { getAppConfig, setAppConfig } from "./log-queries";

export type WebSearchProviderType = "duckduckgo-lite" | "duckduckgo-html" | "duckduckgo-instant" | "brave";

export interface WebSearchProviderRecord {
  type: WebSearchProviderType;
  label: string;
  enabled: boolean;
  priority: number;
  apiKey?: string;
}

const APP_CONFIG_KEY = "web_search_providers_v1";

const DEFAULT_PROVIDERS: WebSearchProviderRecord[] = [
  { type: "duckduckgo-lite", label: "DuckDuckGo Lite", enabled: true, priority: 1 },
  { type: "duckduckgo-html", label: "DuckDuckGo HTML", enabled: true, priority: 2 },
  { type: "duckduckgo-instant", label: "DuckDuckGo Instant", enabled: true, priority: 3 },
  { type: "brave", label: "Brave Search API", enabled: false, priority: 4 },
];

function isProviderType(value: unknown): value is WebSearchProviderType {
  return value === "duckduckgo-lite" || value === "duckduckgo-html" || value === "duckduckgo-instant" || value === "brave";
}

function normalizeProviders(providers: WebSearchProviderRecord[]): WebSearchProviderRecord[] {
  const normalized: WebSearchProviderRecord[] = providers
    .filter((provider) => isProviderType(provider.type))
    .map((provider) => ({
      type: provider.type,
      label: provider.label || DEFAULT_PROVIDERS.find((d) => d.type === provider.type)?.label || provider.type,
      enabled: !!provider.enabled,
      priority: Number.isFinite(provider.priority) ? Math.max(1, Math.floor(provider.priority)) : 99,
      apiKey: provider.apiKey?.trim() || undefined,
    }))
    .sort((left, right) => left.priority - right.priority);

  for (const fallback of DEFAULT_PROVIDERS) {
    if (!normalized.some((provider) => provider.type === fallback.type)) {
      normalized.push({ ...fallback, apiKey: fallback.apiKey });
    }
  }

  return normalized.sort((left, right) => left.priority - right.priority);
}

function serializeProviders(providers: WebSearchProviderRecord[]): string {
  const toStore = providers.map((provider) => ({
    ...provider,
    apiKey: provider.apiKey ? encryptField(provider.apiKey) : undefined,
  }));

  return JSON.stringify(toStore);
}

function parseProviders(raw: string): WebSearchProviderRecord[] {
  const parsed = JSON.parse(raw) as Array<{
    type?: unknown;
    label?: unknown;
    enabled?: unknown;
    priority?: unknown;
    apiKey?: unknown;
  }>;

  const providers: WebSearchProviderRecord[] = [];
  for (const item of parsed) {
    if (!isProviderType(item.type)) continue;

    const decryptedApiKey = typeof item.apiKey === "string" ? decryptField(item.apiKey) || undefined : undefined;

    providers.push({
      type: item.type,
      label: typeof item.label === "string" ? item.label : item.type,
      enabled: !!item.enabled,
      priority: typeof item.priority === "number" ? item.priority : 99,
      apiKey: decryptedApiKey,
    });
  }

  return normalizeProviders(providers);
}

export function getWebSearchProviderConfig(): WebSearchProviderRecord[] {
  try {
    const raw = getAppConfig(APP_CONFIG_KEY);
    if (!raw) return normalizeProviders(DEFAULT_PROVIDERS.map((provider) => ({ ...provider })));
    return parseProviders(raw);
  } catch {
    return normalizeProviders(DEFAULT_PROVIDERS.map((provider) => ({ ...provider })));
  }
}

export function saveWebSearchProviderConfig(providers: WebSearchProviderRecord[]): WebSearchProviderRecord[] {
  const normalized = normalizeProviders(providers);
  setAppConfig(APP_CONFIG_KEY, serializeProviders(normalized));
  return normalized;
}
