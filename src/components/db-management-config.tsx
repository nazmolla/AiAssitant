"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface DbMaintenanceConfig {
  enabled: boolean;
  intervalHours: number;
  logsRetentionDays: number;
  threadsRetentionDays: number;
  attachmentsRetentionDays: number;
  cleanupLogs: boolean;
  cleanupThreads: boolean;
  cleanupAttachments: boolean;
  cleanupOrphanFiles: boolean;
  lastRunAt: string | null;
}

interface DbTableBreakdown {
  table: string;
  rowCount: number;
  estimatedBytes: number | null;
}

interface DbStorageStats {
  dbPath: string;
  dbBytes: number;
  walBytes: number;
  shmBytes: number;
  attachmentsBytes: number;
  totalManagedBytes: number;
  pageCount: number;
  pageSize: number;
  tables: DbTableBreakdown[];
}

interface HostResourceUsage {
  platform: string;
  uptimeSec: number;
  cpuCount: number;
  loadAvg: number[];
  process: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
  };
  system: {
    totalMemBytes: number;
    freeMemBytes: number;
  };
}

interface DbMaintenanceRunResult {
  mode: "manual" | "scheduled";
  startedAt: string;
  completedAt: string;
  deletedLogs: number;
  deletedThreads: number;
  deletedMessages: number;
  deletedAttachmentRows: number;
  deletedFiles: number;
  deletedOrphanFiles: number;
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let idx = 0;
  let num = value;
  while (num >= 1024 && idx < units.length - 1) {
    num /= 1024;
    idx += 1;
  }
  return `${num.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
}

function LabeledToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-foreground cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
      {label}
    </label>
  );
}

export function DbManagementConfig() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [config, setConfig] = useState<DbMaintenanceConfig | null>(null);
  const [storage, setStorage] = useState<DbStorageStats | null>(null);
  const [resources, setResources] = useState<HostResourceUsage | null>(null);
  const [lastRun, setLastRun] = useState<DbMaintenanceRunResult | null>(null);

  const load = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch("/api/config/db-management");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data?.error || "Failed to load DB management settings.");
        return;
      }
      setConfig(data.config);
      setStorage(data.storage);
      setResources(data.resources);
    } catch {
      setMessage("Failed to load DB management settings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    if (!config) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/config/db-management", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data?.error || "Failed to save DB maintenance policy.");
        return;
      }
      setConfig(data.config);
      setMessage("DB maintenance policy saved.");
    } catch {
      setMessage("Failed to save DB maintenance policy.");
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    setRunning(true);
    setMessage(null);
    try {
      const res = await fetch("/api/config/db-management", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data?.error || "DB maintenance run failed.");
        return;
      }
      setLastRun(data.result || null);
      setStorage(data.storage || null);
      await load();
      setMessage("DB maintenance run completed.");
    } catch {
      setMessage("DB maintenance run failed.");
    } finally {
      setRunning(false);
    }
  };

  const tableRows = useMemo(() => storage?.tables || [], [storage]);

  if (loading || !config || !storage || !resources) {
    return (
      <div className="text-sm text-muted-foreground">Loading DB management settings...</div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display">DB Size and Table Breakdown</CardTitle>
          <CardDescription className="text-muted-foreground/70">
            Monitor managed storage growth across database files and attachments.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <div>Total managed: <strong>{formatBytes(storage.totalManagedBytes)}</strong></div>
            <div>Database file: <strong>{formatBytes(storage.dbBytes)}</strong></div>
            <div>WAL file: <strong>{formatBytes(storage.walBytes)}</strong></div>
            <div>SHM file: <strong>{formatBytes(storage.shmBytes)}</strong></div>
            <div>Attachments dir: <strong>{formatBytes(storage.attachmentsBytes)}</strong></div>
            <div>SQLite pages: <strong>{storage.pageCount}</strong> @ {storage.pageSize} bytes</div>
          </div>

          <div className="overflow-x-auto rounded border border-border/60">
            <table className="w-full text-xs sm:text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left">Table</th>
                  <th className="px-3 py-2 text-right">Rows</th>
                  <th className="px-3 py-2 text-right">Estimated Size</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row) => (
                  <tr key={row.table} className="border-t border-border/50">
                    <td className="px-3 py-2">{row.table}</td>
                    <td className="px-3 py-2 text-right">{row.rowCount.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">{row.estimatedBytes === null ? "n/a" : formatBytes(row.estimatedBytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display">Host Resource Snapshot</CardTitle>
          <CardDescription className="text-muted-foreground/70">
            Runtime process and host-level metrics for CPU, RAM, and uptime.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <div>Platform: <strong>{resources.platform}</strong></div>
          <div>Uptime: <strong>{Math.floor(resources.uptimeSec / 60)} min</strong></div>
          <div>CPU cores: <strong>{resources.cpuCount}</strong></div>
          <div>Load avg (1/5/15): <strong>{resources.loadAvg.map((v) => v.toFixed(2)).join(" / ")}</strong></div>
          <div>Process RSS: <strong>{formatBytes(resources.process.rssBytes)}</strong></div>
          <div>Heap used: <strong>{formatBytes(resources.process.heapUsedBytes)}</strong></div>
          <div>System RAM used: <strong>{formatBytes(resources.system.totalMemBytes - resources.system.freeMemBytes)}</strong></div>
          <div>System RAM total: <strong>{formatBytes(resources.system.totalMemBytes)}</strong></div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display">Cleanup Policy and Recurring Job</CardTitle>
          <CardDescription className="text-muted-foreground/70">
            Choose what to clean, set retention windows, and run a recurring maintenance cycle.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <LabeledToggle label="Enable recurring maintenance" checked={config.enabled} onChange={(next) => setConfig({ ...config, enabled: next })} />
            <LabeledToggle label="Clean logs" checked={config.cleanupLogs} onChange={(next) => setConfig({ ...config, cleanupLogs: next })} />
            <LabeledToggle label="Clean old threads and conversations" checked={config.cleanupThreads} onChange={(next) => setConfig({ ...config, cleanupThreads: next })} />
            <LabeledToggle label="Clean old attachment rows/files" checked={config.cleanupAttachments} onChange={(next) => setConfig({ ...config, cleanupAttachments: next })} />
            <LabeledToggle label="Clean orphan files on disk" checked={config.cleanupOrphanFiles} onChange={(next) => setConfig({ ...config, cleanupOrphanFiles: next })} />
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs text-muted-foreground">
              Interval (hours)
              <input
                value={config.intervalHours}
                onChange={(e) => setConfig({ ...config, intervalHours: Number.parseInt(e.target.value, 10) || 24 })}
                inputMode="numeric"
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Log retention (days)
              <input
                value={config.logsRetentionDays}
                onChange={(e) => setConfig({ ...config, logsRetentionDays: Number.parseInt(e.target.value, 10) || 30 })}
                inputMode="numeric"
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Thread retention (days)
              <input
                value={config.threadsRetentionDays}
                onChange={(e) => setConfig({ ...config, threadsRetentionDays: Number.parseInt(e.target.value, 10) || 90 })}
                inputMode="numeric"
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Attachment retention (days)
              <input
                value={config.attachmentsRetentionDays}
                onChange={(e) => setConfig({ ...config, attachmentsRetentionDays: Number.parseInt(e.target.value, 10) || 90 })}
                inputMode="numeric"
                className="mt-1 w-full rounded border border-border bg-background px-2 py-1 text-sm"
              />
            </label>
          </div>

          <div className="text-xs text-muted-foreground">
            Last scheduled/manual run: {config.lastRunAt ? new Date(config.lastRunAt).toLocaleString() : "never"}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save Policy"}</Button>
            <Button variant="outline" onClick={runNow} disabled={running}>{running ? "Running..." : "Run Cleanup Now"}</Button>
            <Button variant="ghost" onClick={load} disabled={loading}>Refresh Snapshot</Button>
          </div>
        </CardContent>
      </Card>

      {lastRun && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-display">Last Cleanup Result</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <div>Mode: <strong>{lastRun.mode}</strong></div>
            <div>Deleted logs: <strong>{lastRun.deletedLogs}</strong></div>
            <div>Deleted threads: <strong>{lastRun.deletedThreads}</strong></div>
            <div>Deleted messages: <strong>{lastRun.deletedMessages}</strong></div>
            <div>Deleted attachment rows: <strong>{lastRun.deletedAttachmentRows}</strong></div>
            <div>Deleted files: <strong>{lastRun.deletedFiles}</strong></div>
            <div>Deleted orphan files: <strong>{lastRun.deletedOrphanFiles}</strong></div>
          </CardContent>
        </Card>
      )}

      {message && <div className="text-sm text-muted-foreground">{message}</div>}
    </div>
  );
}
