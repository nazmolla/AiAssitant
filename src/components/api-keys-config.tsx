"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useTheme } from "@/components/theme-provider";
import { useToast } from "@/hooks/use-toast";

const ALL_SCOPES = ["chat", "knowledge", "approvals", "threads", "logs"] as const;

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  chat: "Send messages and receive responses",
  knowledge: "Read and manage knowledge vault",
  approvals: "View and act on tool approvals",
  threads: "List, create, and read threads",
  logs: "Read runtime logs and stream log events",
};

interface ApiKey {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  scopes: string;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
  rawKey?: string; // only present once, right after creation
}

export function ApiKeysConfig() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [newKeyRevealed, setNewKeyRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["chat"]);
  const [expiresIn, setExpiresIn] = useState<string>("");

  const { formatDate } = useTheme();
  const { toastSnackbar, showToast } = useToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/config/api-keys");
      if (res.ok) setKeys(await res.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      let expiresAt: string | undefined;
      if (expiresIn) {
        const d = new Date();
        const days = parseInt(expiresIn);
        if (days > 0) {
          d.setDate(d.getDate() + days);
          expiresAt = d.toISOString();
        }
      }

      const res = await fetch("/api/config/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), scopes, expiresAt }),
      });
      if (res.ok) {
        const data = await res.json();
        setNewKeyRevealed(data.rawKey);
        setShowForm(false);
        setName("");
        setScopes(["chat"]);
        setExpiresIn("");
        await load();
      } else {
        const err = await res.json();
        showToast(err.error || "Failed to create key");
      }
    } catch {
      showToast("Failed to create key");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch("/api/config/api-keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setDeleteConfirm(null);
        await load();
      } else {
        const err = await res.json();
        showToast(err.error || "Failed to delete key");
      }
    } catch {
      showToast("Failed to delete key");
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const toggleScope = (scope: string) => {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="h-6 w-6 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Newly created key reveal banner */}
      {newKeyRevealed && (
        <Card className="glass-card border-green-500/30 bg-green-500/5">
          <CardContent className="pt-4 pb-4">
            <div className="space-y-2">
              <p className="text-sm font-medium text-green-400">
                ✅ API key created — copy it now, it won&apos;t be shown again!
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-background/50 border border-border rounded px-3 py-2 text-xs font-mono break-all select-all">
                  {newKeyRevealed}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => copyToClipboard(newKeyRevealed)}
                >
                  {copied ? "✓ Copied" : "📋 Copy"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Use this key in your mobile app or script:&nbsp;
                <code className="text-primary">Authorization: Bearer {newKeyRevealed.slice(0, 8)}…</code>
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs"
                onClick={() => setNewKeyRevealed(null)}
              >
                Dismiss
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm text-muted-foreground">
        <span>{keys.length} API key{keys.length !== 1 ? "s" : ""}</span>
        <Button
          size="sm"
          className="h-8 text-xs"
          onClick={() => setShowForm(!showForm)}
        >
          {showForm ? "Cancel" : "+ New API Key"}
        </Button>
      </div>

      {/* Create form */}
      {showForm && (
        <Card className="glass-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Create API Key</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Name */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Key Name</label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Mobile App, Home Assistant"
                className="text-sm"
              />
            </div>

            {/* Scopes */}
            <div>
              <label className="text-xs text-muted-foreground mb-2 block">Scopes</label>
              <div className="flex flex-wrap gap-2">
                {ALL_SCOPES.map((scope) => (
                  <button
                    key={scope}
                    onClick={() => toggleScope(scope)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition-colors ${
                      scopes.includes(scope)
                        ? "bg-primary/15 text-primary border-primary/30"
                        : "bg-background border-border text-muted-foreground hover:border-primary/20"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${
                      scopes.includes(scope) ? "bg-primary" : "bg-muted-foreground/30"
                    }`} />
                    {scope}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                {scopes.map((s) => SCOPE_DESCRIPTIONS[s]).join("; ") || "Select at least one scope"}
              </p>
            </div>

            {/* Expiration */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Expires in (days)</label>
              <div className="flex gap-2">
                {["30", "90", "365", ""].map((val) => (
                  <button
                    key={val || "never"}
                    onClick={() => setExpiresIn(val)}
                    className={`px-3 py-1 rounded text-xs border transition-colors ${
                      expiresIn === val
                        ? "bg-primary/15 text-primary border-primary/30"
                        : "bg-background border-border text-muted-foreground hover:border-primary/20"
                    }`}
                  >
                    {val ? `${val}d` : "Never"}
                  </button>
                ))}
              </div>
            </div>

            {/* Submit */}
            <Button
              onClick={handleCreate}
              disabled={!name.trim() || scopes.length === 0 || creating}
              className="w-full sm:w-auto"
            >
              {creating ? "Creating…" : "Create Key"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Key list */}
      {keys.length === 0 && !showForm ? (
        <Card className="glass-card">
          <CardContent className="py-8 text-center text-muted-foreground text-sm">
            <p>No API keys yet.</p>
            <p className="text-xs mt-1">Create one to authenticate mobile apps, scripts, or external integrations.</p>
          </CardContent>
        </Card>
      ) : (
        keys.map((key) => {
          const parsedScopes: string[] = JSON.parse(key.scopes);
          const isExpired = key.expires_at && new Date(key.expires_at) < new Date();

          return (
            <Card key={key.id} className={`glass-card transition-all ${isExpired ? "opacity-50" : ""}`}>
              <CardContent className="py-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{key.name}</span>
                      <code className="text-xs text-muted-foreground font-mono bg-muted/50 px-1.5 py-0.5 rounded">
                        {key.key_prefix}…
                      </code>
                      {isExpired && (
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">expired</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {parsedScopes.map((s) => (
                        <Badge
                          key={s}
                          variant="secondary"
                          className="text-[10px] px-1.5 py-0"
                        >
                          {s}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Created {formatDate(key.created_at, { year: "numeric", month: "short", day: "numeric" })}
                      {key.last_used_at
                        ? ` · Last used ${formatDate(key.last_used_at, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`
                        : " · Never used"}
                      {key.expires_at && !isExpired
                        ? ` · Expires ${formatDate(key.expires_at, { year: "numeric", month: "short", day: "numeric" })}`
                        : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 self-end sm:self-center">
                    {deleteConfirm === key.id ? (
                      <>
                        <span className="text-xs text-red-400">Revoke?</span>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-7 text-xs px-3"
                          onClick={() => handleDelete(key.id)}
                        >
                          Confirm
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setDeleteConfirm(null)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        onClick={() => setDeleteConfirm(key.id)}
                      >
                        🗑 Revoke
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}

      {/* Usage instructions */}
      <Card className="glass-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Usage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <p>Use your API key as a Bearer token in the <code className="text-primary">Authorization</code> header:</p>
          <pre className="bg-muted/30 border border-border rounded p-2 overflow-x-auto text-[11px]">
{`curl -H "Authorization: Bearer nxk_your_key_here" \\
     https://your-nexus-host:3000/api/threads`}
          </pre>
          <p className="mt-2">
            <strong>Scopes</strong> restrict which API endpoints the key can access.
            Session-based (browser) authentication has no scope restrictions.
          </p>
        </CardContent>
      </Card>
      {toastSnackbar}
    </div>
  );
}
