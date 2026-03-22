"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ApiKeysConfig } from "@/components/api-keys-config";
import { useConfirm } from "@/hooks/use-confirm";

type AuthProviderType = "azure-ad" | "google" | "discord";

interface AuthProvider {
  id: string;
  provider_type: AuthProviderType;
  label: string;
  client_id: string | null;
  has_client_secret: boolean;
  tenant_id: string | null;
  has_bot_token: boolean;
  application_id: string | null;
  enabled: boolean;
  created_at: string;
}

interface ProviderFormConfig {
  type: AuthProviderType;
  label: string;
  description: string;
  fields: Array<{
    key: string;
    label: string;
    placeholder?: string;
    required?: boolean;
    type?: string;
    helpText?: string;
  }>;
}

const PROVIDER_FORMS: ProviderFormConfig[] = [
  {
    type: "azure-ad",
    label: "Azure AD",
    description: "Enable Azure Active Directory single sign-on for your organization.",
    fields: [
      { key: "client_id", label: "Client ID", required: true, placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
      { key: "client_secret", label: "Client Secret", required: true, type: "password" },
      { key: "tenant_id", label: "Tenant ID", required: true, placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
    ],
  },
  {
    type: "google",
    label: "Google",
    description: "Enable Google OAuth sign-in.",
    fields: [
      { key: "client_id", label: "Client ID", required: true, placeholder: "xxxx.apps.googleusercontent.com" },
      { key: "client_secret", label: "Client Secret", required: true, type: "password" },
    ],
  },
  {
    type: "discord",
    label: "Discord Bot",
    description: "Configure the Discord bot for channel integration (not OAuth login).",
    fields: [
      { key: "bot_token", label: "Bot Token", required: true, type: "password" },
      { key: "application_id", label: "Application ID", required: true },
    ],
  },
];

export function AuthConfig() {
  const [providers, setProviders] = useState<AuthProvider[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingType, setEditingType] = useState<AuthProviderType | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { confirmDialog, openConfirm } = useConfirm();

  const fetchProviders = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/config/auth");
      if (res.ok) setProviders(await res.json());
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => { fetchProviders(); }, []);

  const getExisting = (type: AuthProviderType) => providers.find((p) => p.provider_type === type);

  const startEdit = (form: ProviderFormConfig) => {
    const existing = getExisting(form.type);
    const values: Record<string, string> = {};
    for (const f of form.fields) {
      if (f.type === "password") {
        values[f.key] = ""; // don't prefill secrets
      } else {
        values[f.key] = (existing as unknown as Record<string, unknown>)?.[f.key] as string || "";
      }
    }
    setFormValues(values);
    setEditingType(form.type);
    setFormError(null);
  };

  const cancelEdit = () => {
    setEditingType(null);
    setFormValues({});
    setFormError(null);
  };

  const handleSave = async (form: ProviderFormConfig) => {
    setSaving(true);
    setFormError(null);

    const body: Record<string, unknown> = {
      provider_type: form.type,
      label: form.label,
      enabled: true,
    };

    const existing = getExisting(form.type);

    // Only send non-empty values (allows partial updates without overwriting secrets)
    for (const f of form.fields) {
      const val = formValues[f.key]?.trim();
      if (val) {
        body[f.key] = val;
      } else if (f.required && !existing) {
        setFormError(`${f.label} is required.`);
        setSaving(false);
        return;
      }
    }

    try {
      const method = existing ? "PATCH" : "POST";
      if (existing) body.id = existing.id;

      const res = await fetch("/api/config/auth", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        setFormError(err.error || "Failed to save.");
        setSaving(false);
        return;
      }
      await fetchProviders();
      cancelEdit();
    } catch {
      setFormError("Network error.");
    }
    setSaving(false);
  };

  const handleToggle = async (provider: AuthProvider) => {
    await fetch("/api/config/auth", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: provider.id, enabled: !provider.enabled }),
    });
    await fetchProviders();
  };

  const handleDelete = async (provider: AuthProvider) => {
    if (!(await openConfirm(`Remove ${provider.label} configuration?`))) return;
    await fetch(`/api/config/auth?id=${provider.id}`, { method: "DELETE" });
    await fetchProviders();
  };

  return (
    <div className="space-y-4">
      {loading && <p className="text-sm text-muted-foreground">Loading...</p>}

      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mt-2">OAuth Providers</h3>

      {PROVIDER_FORMS.map((form) => {
        const existing = getExisting(form.type);
        const isEditing = editingType === form.type;

        return (
          <Card key={form.type} className={cn("transition-all", existing?.enabled && "border-primary/30")}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    {form.label}
                    {existing && (
                      <Badge variant={existing.enabled ? "default" : "secondary"} className="text-[10px]">
                        {existing.enabled ? "Active" : "Disabled"}
                      </Badge>
                    )}
                    {!existing && (
                      <Badge variant="outline" className="text-[10px] text-muted-foreground">
                        Not Configured
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="text-xs mt-1">{form.description}</CardDescription>
                </div>
                {existing && (
                  <Switch
                    checked={existing.enabled}
                    onCheckedChange={() => handleToggle(existing)}
                    aria-label={`Toggle ${form.label}`}
                  />
                )}
              </div>
            </CardHeader>

            {isEditing ? (
              <>
                <CardContent className="space-y-3">
                  {form.fields.map((f) => (
                    <div key={f.key}>
                      <label className="text-xs text-muted-foreground mb-1 block">
                        {f.label} {f.required && <span className="text-red-400">*</span>}
                      </label>
                      <Input
                        type={f.type || "text"}
                        placeholder={
                          f.type === "password" && existing
                            ? "(unchanged — leave blank to keep)"
                            : f.placeholder
                        }
                        value={formValues[f.key] || ""}
                        onChange={(e) =>
                          setFormValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                        }
                      />
                    </div>
                  ))}
                  {formError && <p className="text-xs text-red-400">{formError}</p>}
                </CardContent>
                <CardFooter className="gap-2">
                  <Button size="sm" onClick={() => handleSave(form)} disabled={saving}>
                    {saving ? "Saving..." : "Save"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={cancelEdit}>
                    Cancel
                  </Button>
                </CardFooter>
              </>
            ) : (
              <CardContent className="pt-0">
                {existing ? (
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => startEdit(form)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300" onClick={() => handleDelete(existing)}>
                      Remove
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => startEdit(form)}>
                    Configure
                  </Button>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}

      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mt-6 pt-4 border-t border-border">API Keys</h3>
      <p className="text-xs text-muted-foreground -mt-2">Create bearer tokens for mobile apps, scripts, and external integrations.</p>
      <ApiKeysConfig />
      {confirmDialog}
    </div>
  );
}
