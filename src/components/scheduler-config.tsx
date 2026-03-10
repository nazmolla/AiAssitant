"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const PRESETS = [
  { label: "Every 5 min", value: "*/5 * * * *" },
  { label: "Every 15 min", value: "*/15 * * * *" },
  { label: "Every 30 min", value: "*/30 * * * *" },
  { label: "Hourly", value: "0 * * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Daily at midnight", value: "0 0 * * *" },
];

export function SchedulerConfig() {
  const [schedule, setSchedule] = useState("*/15 * * * *");
  const [kmEnabled, setKmEnabled] = useState(true);
  const [kmHour, setKmHour] = useState(20);
  const [kmMinute, setKmMinute] = useState(0);
  const [kmPollSeconds, setKmPollSeconds] = useState(60);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    try {
      const res = await fetch("/api/config/scheduler");
      if (!res.ok) return;
      const data = await res.json();
      if (data?.cron_schedule) setSchedule(data.cron_schedule);
      if (data?.knowledge_maintenance) {
        setKmEnabled(Boolean(data.knowledge_maintenance.enabled));
        setKmHour(Number(data.knowledge_maintenance.hour ?? 20));
        setKmMinute(Number(data.knowledge_maintenance.minute ?? 0));
        setKmPollSeconds(Number(data.knowledge_maintenance.poll_seconds ?? 60));
      }
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/config/scheduler", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cron_schedule: schedule,
          knowledge_maintenance: {
            enabled: kmEnabled,
            hour: kmHour,
            minute: kmMinute,
            poll_seconds: kmPollSeconds,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data?.error || "Failed to save scheduler config.");
      } else {
        setMessage("Scheduler and knowledge maintenance settings updated.");
      }
    } catch {
      setMessage("Failed to save scheduler config.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display">Proactive Scheduler</CardTitle>
          <CardDescription className="text-muted-foreground/60">
            Configure how often the proactive observer scans for updates and actions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className="text-[11px] font-medium text-muted-foreground/60 mb-1.5 block uppercase tracking-wider">
              Cron Schedule
            </label>
            <input
              type="text"
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="*/15 * * * *"
              className="w-full rounded-lg border border-white/[0.08] bg-background px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            <p className="text-[10px] text-muted-foreground/50 mt-1">
              Standard 5-field cron: minute hour day-of-month month day-of-week
            </p>
          </div>

          <div>
            <label className="text-[11px] font-medium text-muted-foreground/60 mb-1.5 block uppercase tracking-wider">
              Quick Presets
            </label>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setSchedule(p.value)}
                  className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                    schedule === p.value
                      ? "bg-primary/20 border-primary/40 text-primary"
                      : "border-white/[0.08] text-muted-foreground hover:bg-white/[0.04]"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {message && (
            <p className={`text-xs ${message.includes("Failed") || message.includes("Invalid") ? "text-red-400" : "text-green-400"}`}>
              {message}
            </p>
          )}

          <div className="flex justify-end">
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save & Restart Scheduler"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display">Knowledge Maintenance</CardTitle>
          <CardDescription className="text-muted-foreground/60">
            Configure nightly knowledge declutter and deduplication in a separate background worker thread.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={kmEnabled}
              onChange={(e) => setKmEnabled(e.target.checked)}
              className="h-4 w-4"
            />
            Enable nightly knowledge maintenance
          </label>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground/60 mb-1.5 block uppercase tracking-wider">
                Run Hour (0-23)
              </label>
              <input
                type="number"
                min={0}
                max={23}
                value={kmHour}
                onChange={(e) => setKmHour(Math.max(0, Math.min(23, Number(e.target.value) || 0)))}
                className="w-full rounded-lg border border-white/[0.08] bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground/60 mb-1.5 block uppercase tracking-wider">
                Run Minute (0-59)
              </label>
              <input
                type="number"
                min={0}
                max={59}
                value={kmMinute}
                onChange={(e) => setKmMinute(Math.max(0, Math.min(59, Number(e.target.value) || 0)))}
                className="w-full rounded-lg border border-white/[0.08] bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground/60 mb-1.5 block uppercase tracking-wider">
                Poll Seconds (30-300)
              </label>
              <input
                type="number"
                min={30}
                max={300}
                value={kmPollSeconds}
                onChange={(e) => setKmPollSeconds(Math.max(30, Math.min(300, Number(e.target.value) || 60)))}
                className="w-full rounded-lg border border-white/[0.08] bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground/50">
            Maintenance runs once per day after the configured local time and removes empty/duplicate knowledge rows.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
