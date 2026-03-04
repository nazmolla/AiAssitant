"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type LlmProviderType = "azure-openai" | "openai" | "anthropic" | "litellm";
type LlmProviderPurpose = "chat" | "embedding" | "tts" | "stt";
type RoutingTier = "primary" | "secondary" | "local";

const PROVIDER_LABELS: Record<LlmProviderType, string> = {
  "azure-openai": "Azure OpenAI",
  openai: "OpenAI",
  anthropic: "Anthropic",
  litellm: "LiteLLM (Local)",
};

const ROUTING_TIER_OPTIONS: Array<{ label: string; value: RoutingTier | "" }> = [
  { value: "", label: "Auto-detect" },
  { value: "primary", label: "Primary (cloud)" },
  { value: "secondary", label: "Secondary (fallback)" },
  { value: "local", label: "Local (self-hosted)" },
];

const TIER_BADGE_COLORS: Record<string, string> = {
  primary: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  secondary: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  local: "bg-green-500/15 text-green-400 border-green-500/20",
};

const PROVIDER_FIELDS: Record<
  LlmProviderType,
  Array<{ key: string; label: string; placeholder?: string; required?: boolean; type?: string }>
> = {
  "azure-openai": [
    { key: "apiKey", label: "API Key", required: true, type: "password" },
    { key: "endpoint", label: "Endpoint URL", required: true, placeholder: "https://YOUR-RESOURCE.openai.azure.com" },
    { key: "deployment", label: "Deployment Name", required: true, placeholder: "gpt-4o" },
    { key: "apiVersion", label: "API Version", placeholder: "2024-08-01-preview" },
  ],
  openai: [
    { key: "apiKey", label: "API Key", required: true, type: "password" },
    { key: "model", label: "Model", placeholder: "gpt-4o" },
    { key: "baseURL", label: "Base URL (optional)", placeholder: "https://api.openai.com/v1" },
  ],
  anthropic: [
    { key: "apiKey", label: "API Key", required: true, type: "password" },
    { key: "model", label: "Model", placeholder: "claude-3-5-sonnet" },
  ],
  litellm: [
    { key: "baseURL", label: "Base URL", required: true, placeholder: "http://localhost:4000" },
    { key: "model", label: "Model", required: true, placeholder: "ollama/llama3" },
    { key: "apiKey", label: "API Key (optional)", type: "password", placeholder: "Leave empty if not required" },
  ],
};



const PROVIDER_SELECT: Array<{ label: string; value: LlmProviderType }> = (
  Object.keys(PROVIDER_LABELS) as LlmProviderType[]
).map((value) => ({ value, label: PROVIDER_LABELS[value] }));

const PURPOSE_OPTIONS: Array<{ label: string; value: LlmProviderPurpose }> = [
  { value: "chat", label: "Chat (LLM)" },
  { value: "embedding", label: "Embedding" },
  { value: "tts", label: "Text-to-Speech" },
  { value: "stt", label: "Speech-to-Text" },
];

// Anthropic doesn't offer an embeddings API
const EMBEDDING_CAPABLE_PROVIDERS: Set<LlmProviderType> = new Set<LlmProviderType>(["azure-openai", "openai", "litellm"]);

// TTS/STT require OpenAI-compatible API — Anthropic doesn't offer audio
const AUDIO_CAPABLE_PROVIDERS: Set<LlmProviderType> = new Set<LlmProviderType>(["azure-openai", "openai", "litellm"]);

interface LlmProvider {
  id: string;
  label: string;
  provider_type: LlmProviderType;
  purpose: LlmProviderPurpose;
  config: Record<string, unknown>;
  is_default: boolean;
  created_at: string;
  has_api_key: boolean;
}

type ConfigFormState = Record<string, string>;

const initialConfigState = (provider: LlmProviderType): ConfigFormState => {
  const state: ConfigFormState = {};
  for (const field of PROVIDER_FIELDS[provider]) {
    state[field.key] = "";
  }
  return state;
};

export function LlmConfig() {
  const [providers, setProviders] = useState<LlmProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [providerType, setProviderType] = useState<LlmProviderType>("azure-openai");
  const [purpose, setPurpose] = useState<LlmProviderPurpose>("chat");
  const [label, setLabel] = useState("");
  const [configValues, setConfigValues] = useState<ConfigFormState>(initialConfigState("azure-openai"));
  const [routingTier, setRoutingTier] = useState<RoutingTier | "">("");
  const [disableThinking, setDisableThinking] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const fetchProviders = async () => {
    const res = await fetch("/api/config/llm");
    if (!res.ok) {
      throw new Error("Failed to load providers");
    }
    const data = (await res.json()) as LlmProvider[];
    setProviders(data);
  };

  useEffect(() => {
    fetchProviders().catch((err) => {
      console.error(err);
      setFormError("Unable to load providers. Check server logs.");
    });
  }, []);

  useEffect(() => {
    setConfigValues(initialConfigState(providerType));
    setDisableThinking(false);
    // Reset to chat if current provider can't do embeddings or audio
    if (purpose === "embedding" && !EMBEDDING_CAPABLE_PROVIDERS.has(providerType)) {
      setPurpose("chat");
    }
    if ((purpose === "tts" || purpose === "stt") && !AUDIO_CAPABLE_PROVIDERS.has(providerType)) {
      setPurpose("chat");
    }
  }, [providerType]);

  const currentFields = useMemo(() => {
    return PROVIDER_FIELDS[providerType];
  }, [providerType]);

  const handleConfigChange = (key: string, value: string) => {
    setConfigValues((prev) => ({ ...prev, [key]: value }));
  };

  const resetForm = () => {
    setLabel("");
    setConfigValues(initialConfigState(providerType));
    setRoutingTier("");
    setDisableThinking(false);
    setFormError(null);
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setFormError(null);
    setFormSuccess(null);

    try {
      const payload = {
        label,
        provider_type: providerType,
        purpose,
        config: {
          ...configValues,
          ...(routingTier ? { routingTier } : {}),
          ...(purpose === "chat" && (providerType === "openai" || providerType === "litellm") ? { disableThinking } : {}),
        },
        is_default: providers.filter((p) => p.purpose === purpose).length === 0,
      };
      const res = await fetch("/api/config/llm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Failed to save" }));
        throw new Error(error.error || "Failed to save provider");
      }
      await fetchProviders();
      resetForm();
      setFormSuccess(`${payload.label} saved.`);
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      const res = await fetch("/api/config/llm", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, is_default: true }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Unable to set default" }));
        throw new Error(error.error || "Unable to set default");
      }
      fetchProviders().catch(console.error);
    } catch (err) {
      setFormError((err as Error).message);
    }
  };

  const handleDelete = async (id: string, displayLabel: string) => {
    const confirmed = window.confirm(`Remove ${displayLabel}?`);
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/config/llm?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: "Failed to remove provider" }));
        throw new Error(error.error || "Failed to remove provider");
      }
      fetchProviders().catch(console.error);
    } catch (err) {
      setFormError((err as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display">Add LLM Provider</CardTitle>
          <CardDescription className="text-muted-foreground/60">Configure Azure OpenAI, OpenAI, Anthropic, or LiteLLM credentials.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={handleCreate}>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label className="text-sm font-medium">Display Label</label>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g., Primary Azure" required />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Provider</label>
                <select
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-sm transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 appearance-none"
                  value={providerType}
                  onChange={(e) => setProviderType(e.target.value as LlmProviderType)}
                >
                  {PROVIDER_SELECT.map((option) => (
                    <option key={option.value} value={option.value} className="bg-card">
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Purpose</label>
                <select
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-sm transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 appearance-none"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value as LlmProviderPurpose)}
                >
                  {PURPOSE_OPTIONS
                    .filter((o) =>
                      o.value === "chat" ||
                      (o.value === "embedding" && EMBEDDING_CAPABLE_PROVIDERS.has(providerType)) ||
                      ((o.value === "tts" || o.value === "stt") && AUDIO_CAPABLE_PROVIDERS.has(providerType))
                    )
                    .map((option) => (
                      <option key={option.value} value={option.value} className="bg-card">
                        {option.label}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {/* Routing tier — only for chat providers */}
            {purpose === "chat" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Routing Tier</label>
                <select
                  className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3.5 py-2 text-sm transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 appearance-none"
                  value={routingTier}
                  onChange={(e) => setRoutingTier(e.target.value as RoutingTier | "")}
                >
                  {ROUTING_TIER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value} className="bg-card">
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground/50">
                  Controls how the orchestrator routes tasks. Local = background/simple tasks. Primary = complex reasoning.
                </p>
              </div>
            )}

            {purpose === "chat" && (providerType === "openai" || providerType === "litellm") && (
              <label className="flex items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-3">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={disableThinking}
                  onChange={(e) => setDisableThinking(e.target.checked)}
                />
                <span className="text-sm">
                  <span className="font-medium">Disable Thinking (faster)</span>
                  <span className="block text-[11px] text-muted-foreground/60">
                    Sends <code>think=false</code> to OpenAI-compatible providers where supported (useful for Ollama/Qwen).
                  </span>
                </span>
              </label>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              {currentFields.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <label className="text-[13px] font-medium flex items-center justify-between">
                    {field.label}
                    {field.required && <span className="text-[11px] text-muted-foreground">Required</span>}
                  </label>
                  <Input
                    type={field.type || "text"}
                    value={configValues[field.key] || ""}
                    onChange={(e) => handleConfigChange(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    required={field.required}
                  />
                </div>
              ))}
            </div>

            {formError && <p className="text-sm text-red-400">{formError}</p>}
            {formSuccess && <p className="text-sm text-green-400">{formSuccess}</p>}

            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={resetForm}>
                Reset
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Saving..." : "Save Provider"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-display font-semibold">Configured Providers</h3>
          <span className="text-sm text-muted-foreground/50 font-light">
            {providers.length === 0 ? "No providers yet" : `${providers.length} configured`}
          </span>
        </div>

        {providers.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <div className="text-3xl mb-3 opacity-30">🤖</div>
              <p className="text-sm text-muted-foreground/60 font-light">
                No providers configured. Add one to unlock the agent loop.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {providers.map((provider) => (
              <div
                key={provider.id}
                className={cn(
                  "rounded-xl border p-4 hover:bg-white/[0.02] transition-all duration-300",
                  provider.is_default
                    ? "border-primary/30 bg-primary/[0.03]"
                    : "border-white/[0.06]"
                )}
              >
                <div className="md:hidden space-y-3">
                  <div className="min-w-0">
                    <div className="font-medium text-sm break-words">{provider.label}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {provider.is_default ? (
                        <Badge variant="success" className="text-[10px]">Default</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">Standby</Badge>
                      )}
                      <Badge variant="outline" className="uppercase tracking-wide text-[10px]">
                        {provider.purpose === "embedding" ? "Embedding" : provider.purpose === "tts" ? "TTS" : provider.purpose === "stt" ? "STT" : "Chat"}
                      </Badge>
                      <Badge variant="outline" className="uppercase tracking-wide text-[10px]">
                        {PROVIDER_LABELS[provider.provider_type]}
                      </Badge>
                      {provider.config?.disableThinking === true && (
                        <Badge variant="outline" className="uppercase tracking-wide text-[10px]">No Think</Badge>
                      )}
                      {typeof provider.config?.routingTier === "string" && provider.config.routingTier && (
                        <span className={cn(
                          "px-1.5 py-0.5 rounded-full text-[10px] font-medium border",
                          TIER_BADGE_COLORS[provider.config.routingTier] || "bg-white/5 text-muted-foreground border-white/10"
                        )}>
                          {provider.config.routingTier}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground/40 mt-1 break-words">
                      {Object.entries(provider.config)
                        .filter(([k, v]) => typeof v === "string" && v.length > 0 && k !== "routingTier")
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(" · ") || "No config details"}
                      {provider.has_api_key === false && (
                        <span className="text-red-400 ml-2">⚠ No API key</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!provider.is_default && (
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => handleSetDefault(provider.id)}>
                        Make Default
                      </Button>
                    )}
                    <Button size="sm" variant="destructive" className="flex-1" onClick={() => handleDelete(provider.id, provider.label)}>
                      Remove
                    </Button>
                  </div>
                </div>

                <div className="hidden md:flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{provider.label}</span>
                      {provider.is_default ? (
                        <Badge variant="success" className="text-[10px]">Default</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">Standby</Badge>
                      )}
                      <Badge variant="outline" className="uppercase tracking-wide text-[10px]">
                        {provider.purpose === "embedding" ? "Embedding" : provider.purpose === "tts" ? "TTS" : provider.purpose === "stt" ? "STT" : "Chat"}
                      </Badge>
                      <Badge variant="outline" className="uppercase tracking-wide text-[10px]">
                        {PROVIDER_LABELS[provider.provider_type]}
                      </Badge>
                      {provider.config?.disableThinking === true && (
                        <Badge variant="outline" className="uppercase tracking-wide text-[10px]">No Think</Badge>
                      )}
                      {typeof provider.config?.routingTier === "string" && provider.config.routingTier && (
                        <span className={cn(
                          "px-1.5 py-0.5 rounded-full text-[10px] font-medium border",
                          TIER_BADGE_COLORS[provider.config.routingTier] || "bg-white/5 text-muted-foreground border-white/10"
                        )}>
                          {provider.config.routingTier}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground/40 mt-1">
                      {Object.entries(provider.config)
                        .filter(([k, v]) => typeof v === "string" && v.length > 0 && k !== "routingTier")
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(" · ") || "No config details"}
                      {provider.has_api_key === false && (
                        <span className="text-red-400 ml-2">⚠ No API key</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ml-3 shrink-0">
                    {!provider.is_default && (
                      <Button size="sm" variant="outline" onClick={() => handleSetDefault(provider.id)}>
                        Make Default
                      </Button>
                    )}
                    <Button size="sm" variant="destructive" onClick={() => handleDelete(provider.id, provider.label)}>
                      Remove
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
