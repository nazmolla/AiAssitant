"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type UnifiedLogLevel = "verbose" | "warning" | "error" | "critical";

const LOG_LEVELS: UnifiedLogLevel[] = ["verbose", "warning", "error", "critical"];

export function LoggingConfig() {
  const [minLevel, setMinLevel] = useState<UnifiedLogLevel>("verbose");
  const [cleanupLevel, setCleanupLevel] = useState<UnifiedLogLevel>("warning");
  const [days, setDays] = useState("30");
  const [saving, setSaving] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/config/logging");
      if (!res.ok) return;
      const data = await res.json();
      if (LOG_LEVELS.includes(data?.min_level)) {
        setMinLevel(data.min_level);
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    load();
  }, []);

  const saveMinLevel = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/config/logging", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ min_level: minLevel }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data?.error || "Failed to save logging config.");
      } else {
        setMessage(`Minimum log level updated to ${minLevel}.`);
      }
    } catch {
      setMessage("Failed to save logging config.");
    } finally {
      setSaving(false);
    }
  };

  const cleanLogs = async (mode: "all" | "level" | "older-than-days") => {
    setCleaning(true);
    setMessage(null);
    try {
      const payload =
        mode === "all"
          ? { mode }
          : mode === "level"
            ? { mode, level: cleanupLevel }
            : { mode, days: Number.parseInt(days, 10) || 30 };

      const res = await fetch("/api/logs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data?.error || "Failed to clean logs.");
      } else {
        setMessage(`Deleted ${data?.deleted ?? 0} log entries.`);
      }
    } catch {
      setMessage("Failed to clean logs.");
    } finally {
      setCleaning(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display">Server Logging Policy</CardTitle>
          <CardDescription className="text-muted-foreground/60">
            Minimum level is server-wide. Thought logs are treated as verbose detail.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground/60 mb-1.5 block uppercase tracking-wider">
              Minimum Retained Level
            </label>
            <select
              value={minLevel}
              onChange={(e) => setMinLevel(e.target.value as UnifiedLogLevel)}
              className="w-full rounded-lg border border-white/[0.08] bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="verbose">Verbose (keep all)</option>
              <option value="warning">Warning + Error + Critical</option>
              <option value="error">Error + Critical</option>
              <option value="critical">Critical only</option>
            </select>
          </div>

          <div className="flex justify-end">
            <Button onClick={saveMinLevel} disabled={saving}>
              {saving ? "Saving..." : "Save Logging Policy"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display">Log Cleanup Tools</CardTitle>
          <CardDescription className="text-muted-foreground/60">
            Remove logs globally, by level, or by age.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <Button variant="destructive" disabled={cleaning} onClick={() => cleanLogs("all")}>Clear All Logs</Button>
            <div className="flex gap-2 flex-1">
              <select
                value={cleanupLevel}
                onChange={(e) => setCleanupLevel(e.target.value as UnifiedLogLevel)}
                className="flex-1 rounded-lg border border-white/[0.08] bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {LOG_LEVELS.map((level) => (
                  <option key={level} value={level}>{level}</option>
                ))}
              </select>
              <Button variant="outline" disabled={cleaning} onClick={() => cleanLogs("level")}>Clear Level</Button>
            </div>
          </div>

          <div className="flex gap-2">
            <input
              value={days}
              onChange={(e) => setDays(e.target.value)}
              inputMode="numeric"
              className="w-28 rounded-lg border border-white/[0.08] bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="30"
            />
            <Button variant="outline" disabled={cleaning} onClick={() => cleanLogs("older-than-days")}>Clear Older Than Days</Button>
          </div>
        </CardContent>
      </Card>

      {message && (
        <div className="text-sm text-muted-foreground">{message}</div>
      )}
    </div>
  );
}
