"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

interface Device {
  id: string;
  name: string;
  key_prefix: string;
  last_used_at: string | null;
  created_at: string;
  rawKey?: string;
}

export function DevicesConfig() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const { toastSnackbar, showToast } = useToast();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/devices");
      if (res.ok) setDevices(await res.json());
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Failed" }));
        showToast(err.error ?? "Failed to register device", "error");
        return;
      }
      const device: Device = await res.json();
      setRevealedKey(device.rawKey ?? null);
      setNewName("");
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    const res = await fetch(`/api/devices/${id}`, { method: "DELETE" });
    if (res.ok) {
      setDevices((prev) => prev.filter((d) => d.id !== id));
      setDeleteConfirm(null);
      showToast("Device revoked", "success");
    } else {
      showToast("Failed to revoke device", "error");
    }
  }

  function formatDate(iso: string | null) {
    if (!iso) return "Never";
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
  }

  return (
    <div className="space-y-6">
      {toastSnackbar}

      {/* Register new device */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Register a Device</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Give the device a name, then copy the generated API key onto the ESP32 (stored in NVS flash).
            The key is shown only once.
          </p>
          <div className="flex gap-2">
            <Input
              placeholder="Device name (e.g. Desk ESP32)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
              maxLength={100}
              className="flex-1"
            />
            <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? "Registering…" : "Register"}
            </Button>
          </div>

          {revealedKey && (
            <div className="rounded border border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 p-3 space-y-2">
              <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-300">
                Copy this key now — it will not be shown again.
              </p>
              <code className="block break-all text-xs bg-white dark:bg-black rounded p-2 select-all border">
                {revealedKey}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(revealedKey);
                  showToast("Copied to clipboard", "success");
                }}
              >
                Copy Key
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRevealedKey(null)}
                className="ml-2"
              >
                Dismiss
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Device list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registered Devices</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : devices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No devices registered yet.</p>
          ) : (
            <div className="divide-y">
              {devices.map((device) => (
                <div key={device.id} className="flex items-center justify-between py-3 gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{device.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Key: {device.key_prefix}… &middot; Added: {formatDate(device.created_at)} &middot; Last seen: {formatDate(device.last_used_at)}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {deleteConfirm === device.id ? (
                      <>
                        <Button size="sm" variant="destructive" onClick={() => handleRevoke(device.id)}>
                          Confirm Revoke
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleteConfirm(null)}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => setDeleteConfirm(device.id)}>
                        Revoke
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
