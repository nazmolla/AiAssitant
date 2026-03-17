"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type ProviderType = "duckduckgo-html" | "duckduckgo-instant" | "brave";

interface ProviderConfig {
  type: ProviderType;
  label: string;
  enabled: boolean;
  priority: number;
  hasApiKey?: boolean;
  apiKeyInput?: string;
}

export function SearchProvidersConfig() {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/config/search-providers");
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data?.providers) ? data.providers : [];
      setProviders(
        list
          .map((provider: ProviderConfig) => ({
            ...provider,
            apiKeyInput: "",
          }))
          .sort((left: ProviderConfig, right: ProviderConfig) => left.priority - right.priority)
      );
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const updateProvider = (type: ProviderType, patch: Partial<ProviderConfig>) => {
    setProviders((current) =>
      current.map((provider) =>
        provider.type === type ? { ...provider, ...patch } : provider
      )
    );
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);

    try {
      const payload = providers.map((provider) => ({
        type: provider.type,
        label: provider.label,
        enabled: provider.enabled,
        priority: Number.isFinite(provider.priority) ? provider.priority : 99,
        ...(provider.apiKeyInput && provider.apiKeyInput.trim().length > 0
          ? { apiKey: provider.apiKeyInput.trim() }
          : {}),
      }));

      const res = await fetch("/api/config/search-providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providers: payload }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessage(data?.error || "Failed to save provider configuration.");
        return;
      }

      setMessage("Search provider configuration saved.");
      await load();
    } catch {
      setMessage("Failed to save provider configuration.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display">Web Search Providers</CardTitle>
          <CardDescription className="text-muted-foreground/60">
            Configure provider order and fallbacks for builtin web search. Settings are stored in the database.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {providers.map((provider) => (
            <div key={provider.type} className="rounded-lg border border-white/[0.08] p-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{provider.label}</p>
                  <p className="text-xs text-muted-foreground">{provider.type}</p>
                </div>
                <label className="text-sm flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={provider.enabled}
                    onChange={(e) => updateProvider(provider.type, { enabled: e.target.checked })}
                  />
                  Enabled
                </label>
              </div>

              <div>
                <label className="text-[11px] text-muted-foreground/60 uppercase tracking-wider mb-1 block">
                  Priority (lower runs first)
                </label>
                <input
                  type="number"
                  value={provider.priority}
                  onChange={(e) =>
                    updateProvider(provider.type, {
                      priority: Number.parseInt(e.target.value, 10) || 99,
                    })
                  }
                  className="w-32 rounded-lg border border-white/[0.08] bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
              </div>

              {provider.type === "brave" && (
                <div>
                  <label className="text-[11px] text-muted-foreground/60 uppercase tracking-wider mb-1 block">
                    Brave API Key {provider.hasApiKey ? "(configured)" : "(not configured)"}
                  </label>
                  <input
                    type="password"
                    value={provider.apiKeyInput || ""}
                    onChange={(e) => updateProvider(provider.type, { apiKeyInput: e.target.value })}
                    placeholder={provider.hasApiKey ? "Leave blank to keep existing key" : "Enter Brave API key"}
                    className="w-full rounded-lg border border-white/[0.08] bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </div>
              )}
            </div>
          ))}

          <div className="flex justify-end">
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save Search Providers"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
