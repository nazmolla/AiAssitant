"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type LlmProviderType = "azure-openai" | "openai" | "anthropic";
type LlmProviderPurpose = "chat" | "embedding";

const PROVIDER_LABELS: Record<LlmProviderType, string> = {
  "azure-openai": "Azure OpenAI",
  openai: "OpenAI",
  anthropic: "Anthropic",
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
};

const PROVIDER_SELECT: Array<{ label: string; value: LlmProviderType }> = (
  Object.keys(PROVIDER_LABELS) as LlmProviderType[]
).map((value) => ({ value, label: PROVIDER_LABELS[value] }));

const PURPOSE_OPTIONS: Array<{ label: string; value: LlmProviderPurpose }> = [
  { value: "chat", label: "Chat (LLM)" },
  { value: "embedding", label: "Embedding" },
];

// Anthropic doesn't offer an embeddings API
const EMBEDDING_CAPABLE_PROVIDERS: Set<LlmProviderType> = new Set(["azure-openai", "openai"]);

interface LlmProvider {
  id: string;
  label: string;
  provider_type: LlmProviderType;
  purpose: LlmProviderPurpose;
  config: Record<string, string>;
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
    // Reset to chat if current provider can't do embeddings
    if (purpose === "embedding" && !EMBEDDING_CAPABLE_PROVIDERS.has(providerType)) {
      setPurpose("chat");
    }
  }, [providerType]);

  const currentFields = useMemo(() => PROVIDER_FIELDS[providerType], [providerType]);

  const handleConfigChange = (key: string, value: string) => {
    setConfigValues((prev) => ({ ...prev, [key]: value }));
  };

  const resetForm = () => {
    setLabel("");
    setConfigValues(initialConfigState(providerType));
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
        config: configValues,
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
          <CardTitle className="text-base">Add LLM Provider</CardTitle>
          <CardDescription>Configure Azure OpenAI, OpenAI, or Anthropic credentials.</CardDescription>
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
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={providerType}
                  onChange={(e) => setProviderType(e.target.value as LlmProviderType)}
                >
                  {PROVIDER_SELECT.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Purpose</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value as LlmProviderPurpose)}
                >
                  {PURPOSE_OPTIONS
                    .filter((o) => o.value === "chat" || EMBEDDING_CAPABLE_PROVIDERS.has(providerType))
                    .map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {currentFields.map((field) => (
                <div key={field.key} className="space-y-2">
                  <label className="text-sm font-medium flex items-center justify-between">
                    {field.label}
                    {field.required && <span className="text-xs text-muted-foreground">Required</span>}
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

            {formError && <p className="text-sm text-red-500">{formError}</p>}
            {formSuccess && <p className="text-sm text-green-600">{formSuccess}</p>}

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
          <h3 className="text-base font-semibold">Configured Providers</h3>
          <span className="text-sm text-muted-foreground">
            {providers.length === 0 ? "No providers yet" : `${providers.length} configured`}
          </span>
        </div>

        {providers.length === 0 ? (
          <Card>
            <CardContent className="text-sm text-muted-foreground">
              No providers configured. Add one to unlock the agent loop.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {providers.map((provider) => (
              <Card key={provider.id} className={cn(provider.is_default && "border-primary") }>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-lg">{provider.label}</CardTitle>
                      <CardDescription>
                        {PROVIDER_LABELS[provider.provider_type]} • {new Date(provider.created_at).toLocaleDateString()}
                      </CardDescription>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {provider.is_default ? (
                        <Badge variant="success">Default</Badge>
                      ) : (
                        <Badge variant="secondary">Standby</Badge>
                      )}
                      <Badge variant="outline" className="uppercase tracking-wide text-[10px]">
                        {provider.purpose === "embedding" ? "Embedding" : "Chat"}
                      </Badge>
                      <Badge variant="outline" className="uppercase tracking-wide text-[10px]">
                        {provider.provider_type}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <dl className="grid gap-2 text-sm">
                    {Object.entries(provider.config).map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between border-b border-dashed border-border/60 pb-1 text-xs uppercase tracking-wide text-muted-foreground">
                        <span>{key}</span>
                        <span className="text-foreground font-mono text-[11px]">
                          {typeof value === "string" && value.length > 0 ? value : "—"}
                        </span>
                      </div>
                    ))}
                    {provider.has_api_key === false && (
                      <div className="text-xs text-red-500">No API key captured. Edit to add credentials.</div>
                    )}
                  </dl>
                </CardContent>
                <CardFooter className="flex justify-end gap-3">
                  {!provider.is_default && (
                    <Button size="sm" variant="outline" onClick={() => handleSetDefault(provider.id)}>
                      Make Default
                    </Button>
                  )}
                  <Button size="sm" variant="destructive" onClick={() => handleDelete(provider.id, provider.label)}>
                    Remove
                  </Button>
                </CardFooter>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
