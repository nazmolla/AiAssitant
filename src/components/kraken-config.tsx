"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface KrakenStatus {
  hasCredentials: boolean;
  apiKeyPrefix: string | null;
  updatedAt: string | null;
}

export function KrakenConfig() {
  const [status, setStatus] = useState<KrakenStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const { toastSnackbar, showToast } = useToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/config/integrations/kraken");
      if (res.ok) setStatus(await res.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!apiKey.trim() || !apiSecret.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/config/integrations/kraken", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim(), apiSecret: apiSecret.trim() }),
      });
      if (res.ok) {
        setShowForm(false);
        setApiKey("");
        setApiSecret("");
        await load();
        showToast("Kraken credentials saved.");
      } else {
        const err = await res.json() as { error?: string };
        showToast(err.error ?? "Failed to save credentials.");
      }
    } catch {
      showToast("Failed to save credentials.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch("/api/config/integrations/kraken", { method: "DELETE" });
      if (res.ok) {
        setConfirmDelete(false);
        await load();
        showToast("Kraken credentials removed.");
      } else {
        showToast("Failed to remove credentials.");
      }
    } catch {
      showToast("Failed to remove credentials.");
    } finally {
      setDeleting(false);
    }
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
      {/* Status */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Kraken API Credentials</CardTitle>
            {status?.hasCredentials ? (
              <Badge variant="secondary" className="bg-green-500/15 text-green-400 border border-green-500/30 text-xs">
                Connected
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-xs">Not configured</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {status?.hasCredentials ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                API key:{" "}
                <code className="text-primary font-mono text-xs">{status.apiKeyPrefix}…</code>
                {status.updatedAt && (
                  <span className="ml-2 text-xs">
                    · Updated {new Date(status.updatedAt).toLocaleDateString()}
                  </span>
                )}
              </p>
              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() => { setShowForm(true); setConfirmDelete(false); }}
                >
                  Update credentials
                </Button>
                {confirmDelete ? (
                  <>
                    <span className="text-xs text-red-400 self-center">Remove credentials?</span>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-8 text-xs"
                      disabled={deleting}
                      onClick={handleDelete}
                    >
                      {deleting ? "Removing…" : "Confirm"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs"
                      onClick={() => setConfirmDelete(false)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    onClick={() => setConfirmDelete(true)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Connect your Kraken account to enable crypto trading tools. Credentials are encrypted and stored per user.
              </p>
              <Button size="sm" className="h-8 text-xs" onClick={() => setShowForm(true)}>
                Add credentials
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Credential form */}
      {showForm && (
        <Card className="glass-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {status?.hasCredentials ? "Update Kraken Credentials" : "Add Kraken Credentials"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">API Key</label>
              <Input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Your Kraken API key"
                className="text-sm font-mono"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">API Secret</label>
              <Input
                type="password"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                placeholder="Your Kraken API secret"
                className="text-sm font-mono"
                autoComplete="new-password"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Create a key at <strong>Kraken → Security → API</strong>. Required permissions:{" "}
              <strong>Query Funds</strong>, <strong>Query Open Orders &amp; Trades</strong>.
              Add <strong>Create &amp; Modify Orders</strong> only if you want the agent to place trades.
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!apiKey.trim() || !apiSecret.trim() || saving}
                onClick={handleSave}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { setShowForm(false); setApiKey(""); setApiSecret(""); }}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tool reference */}
      <Card className="glass-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Available tools once configured</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-1">
          <p>• <code className="text-primary">builtin.kraken_balance</code> — account balances</p>
          <p>• <code className="text-primary">builtin.kraken_ticker</code> — live price data</p>
          <p>• <code className="text-primary">builtin.kraken_ohlc</code> — candlestick data</p>
          <p>• <code className="text-primary">builtin.kraken_place_order</code> — buy / sell (requires approval)</p>
          <p>• <code className="text-primary">builtin.kraken_cancel_order</code> — cancel open order (requires approval)</p>
          <p>• <code className="text-primary">builtin.kraken_open_orders</code> — list open orders</p>
          <p>• <code className="text-primary">builtin.kraken_closed_orders</code> — order history</p>
          <p>• <code className="text-primary">builtin.kraken_portfolio</code> — tracked positions</p>
        </CardContent>
      </Card>

      {toastSnackbar}
    </div>
  );
}
