"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type ScheduleStatus = "active" | "paused" | "archived";
type RunStatus = "scheduled" | "queued" | "claimed" | "running" | "success" | "partial_success" | "failed" | "cancelled" | "timeout";

interface SchedulerOverview {
  schedules_total: number;
  schedules_active: number;
  schedules_paused: number;
  runs_running: number;
  runs_failed_24h: number;
  runs_success_24h: number;
  runs_partial_24h: number;
}

interface SchedulerScheduleRecord {
  id: string;
  schedule_key: string;
  name: string;
  trigger_type: string;
  trigger_expr: string;
  status: ScheduleStatus;
  next_run_at: string | null;
  last_run_at: string | null;
  updated_at: string;
}

interface SchedulerRunRecord {
  id: string;
  schedule_id: string;
  trigger_source: string;
  status: RunStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
}

interface SchedulerTaskRunRecord {
  id: string;
  schedule_task_id: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  error_message: string | null;
  log_ref: string | null;
}

interface SchedulerRunDetailResponse {
  run: SchedulerRunRecord;
  schedule: SchedulerScheduleRecord | null;
  task_runs: SchedulerTaskRunRecord[];
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  hasMore: boolean;
}

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

  const [overview, setOverview] = useState<SchedulerOverview | null>(null);
  const [schedules, setSchedules] = useState<SchedulerScheduleRecord[]>([]);
  const [runs, setRuns] = useState<SchedulerRunRecord[]>([]);
  const [loadingConsole, setLoadingConsole] = useState(true);
  const [consoleMessage, setConsoleMessage] = useState<string | null>(null);
  const [runStatusFilter, setRunStatusFilter] = useState<string>("all");
  const [selectedScheduleId, setSelectedScheduleId] = useState<string>("all");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<SchedulerRunDetailResponse | null>(null);
  const [loadingRunDetail, setLoadingRunDetail] = useState(false);

  const formatTs = (value: string | null) => {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  };

  const getRunBadgeClass = (status: string) => {
    if (["queued", "claimed", "running", "retrying"].includes(status)) return "bg-blue-500/20 text-blue-300 border-blue-400/40";
    if (["success"].includes(status)) return "bg-green-500/20 text-green-300 border-green-400/40";
    if (["partial_success"].includes(status)) return "bg-amber-500/20 text-amber-300 border-amber-400/40";
    if (["failed", "timeout", "cancelled"].includes(status)) return "bg-red-500/20 text-red-300 border-red-400/40";
    return "bg-slate-500/20 text-slate-300 border-slate-400/40";
  };

  const loadConsole = async () => {
    setLoadingConsole(true);
    setConsoleMessage(null);
    try {
      const runsUrl = new URL("/api/scheduler/runs", window.location.origin);
      runsUrl.searchParams.set("limit", "30");
      if (runStatusFilter !== "all") runsUrl.searchParams.set("status", runStatusFilter);
      if (selectedScheduleId !== "all") runsUrl.searchParams.set("scheduleId", selectedScheduleId);

      const schedulesUrl = new URL("/api/scheduler/schedules", window.location.origin);
      schedulesUrl.searchParams.set("limit", "30");

      const [overviewRes, schedulesRes, runsRes] = await Promise.all([
        fetch("/api/scheduler/overview"),
        fetch(schedulesUrl.toString()),
        fetch(runsUrl.toString()),
      ]);

      const [overviewJson, schedulesJson, runsJson] = await Promise.all([
        overviewRes.json().catch(() => ({})),
        schedulesRes.json().catch(() => ({})),
        runsRes.json().catch(() => ({})),
      ]);

      if (!overviewRes.ok || !schedulesRes.ok || !runsRes.ok) {
        setConsoleMessage(
          (overviewJson as { error?: string }).error ||
          (schedulesJson as { error?: string }).error ||
          (runsJson as { error?: string }).error ||
          "Failed to load scheduler console."
        );
        return;
      }

      setOverview(overviewJson as SchedulerOverview);
      setSchedules(((schedulesJson as PaginatedResponse<SchedulerScheduleRecord>).data || []).slice(0, 20));
      setRuns(((runsJson as PaginatedResponse<SchedulerRunRecord>).data || []).slice(0, 25));
    } catch {
      setConsoleMessage("Failed to load scheduler console.");
    } finally {
      setLoadingConsole(false);
    }
  };

  const loadRunDetail = async (runId: string) => {
    setSelectedRunId(runId);
    setLoadingRunDetail(true);
    try {
      const res = await fetch(`/api/scheduler/runs/${runId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConsoleMessage((data as { error?: string }).error || "Failed to load run detail.");
        setRunDetail(null);
        return;
      }
      setRunDetail(data as SchedulerRunDetailResponse);
    } catch {
      setConsoleMessage("Failed to load run detail.");
      setRunDetail(null);
    } finally {
      setLoadingRunDetail(false);
    }
  };

  const controlSchedule = async (scheduleId: string, action: "pause" | "resume" | "trigger") => {
    setConsoleMessage(null);
    try {
      const res = await fetch(`/api/scheduler/schedules/${scheduleId}/${action}`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConsoleMessage((data as { error?: string }).error || `Failed to ${action} schedule.`);
        return;
      }
      setConsoleMessage(action === "trigger" ? "Run queued successfully." : `Schedule ${action}d successfully.`);
      await loadConsole();
    } catch {
      setConsoleMessage(`Failed to ${action} schedule.`);
    }
  };

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

  useEffect(() => {
    loadConsole();
    const timer = window.setInterval(() => {
      loadConsole();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [runStatusFilter, selectedScheduleId]);

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
          <CardTitle className="text-base font-display">Scheduler Console</CardTitle>
          <CardDescription className="text-muted-foreground/60">
            Unified visibility for schedules, run history, and task-level execution with quick controls.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingConsole && <div className="text-sm text-muted-foreground">Loading scheduler overview...</div>}

          {!loadingConsole && overview && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-white/[0.08] p-3 text-sm">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground/60">Schedules</div>
                <div className="text-xl font-semibold">{overview.schedules_total}</div>
                <div className="text-xs text-muted-foreground/70">{overview.schedules_active} active / {overview.schedules_paused} paused</div>
              </div>
              <div className="rounded-lg border border-white/[0.08] p-3 text-sm">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground/60">Running Now</div>
                <div className="text-xl font-semibold">{overview.runs_running}</div>
                <div className="text-xs text-muted-foreground/70">Queued, claimed, or running</div>
              </div>
              <div className="rounded-lg border border-white/[0.08] p-3 text-sm">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground/60">Success (24h)</div>
                <div className="text-xl font-semibold text-green-300">{overview.runs_success_24h}</div>
                <div className="text-xs text-muted-foreground/70">Partial: {overview.runs_partial_24h}</div>
              </div>
              <div className="rounded-lg border border-white/[0.08] p-3 text-sm">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground/60">Failed (24h)</div>
                <div className="text-xl font-semibold text-red-300">{overview.runs_failed_24h}</div>
                <div className="text-xs text-muted-foreground/70">Requires investigation</div>
              </div>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Schedules</h3>
                <Button variant="outline" size="sm" onClick={loadConsole}>Refresh</Button>
              </div>
              <div className="overflow-x-auto rounded border border-white/[0.08]">
                <table className="w-full text-xs sm:text-sm">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="px-2 py-2 text-left">Name</th>
                      <th className="px-2 py-2 text-left">Status</th>
                      <th className="px-2 py-2 text-left">Next Run</th>
                      <th className="px-2 py-2 text-right">Controls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((s) => (
                      <tr key={s.id} className="border-t border-white/[0.06] align-top">
                        <td className="px-2 py-2">
                          <div className="font-medium">{s.name}</div>
                          <div className="text-[10px] text-muted-foreground/70 font-mono">{s.schedule_key}</div>
                          <button
                            className="mt-1 text-[10px] text-primary underline"
                            onClick={() => setSelectedScheduleId(s.id)}
                            type="button"
                          >
                            Filter runs by this schedule
                          </button>
                        </td>
                        <td className="px-2 py-2">
                          <span className={`inline-block rounded border px-2 py-0.5 text-[10px] uppercase tracking-wider ${getRunBadgeClass(s.status)}`}>
                            {s.status}
                          </span>
                        </td>
                        <td className="px-2 py-2 whitespace-nowrap">{formatTs(s.next_run_at)}</td>
                        <td className="px-2 py-2 text-right">
                          <div className="flex flex-wrap justify-end gap-1">
                            {s.status === "active" ? (
                              <Button variant="outline" size="sm" onClick={() => controlSchedule(s.id, "pause")}>Pause</Button>
                            ) : (
                              <Button variant="outline" size="sm" onClick={() => controlSchedule(s.id, "resume")}>Resume</Button>
                            )}
                            <Button size="sm" onClick={() => controlSchedule(s.id, "trigger")}>Trigger</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {schedules.length === 0 && !loadingConsole && (
                      <tr>
                        <td className="px-2 py-3 text-muted-foreground" colSpan={4}>No schedules found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Recent Runs</h3>
                <div className="flex flex-wrap gap-2">
                  <select
                    className="rounded border border-white/[0.08] bg-background px-2 py-1 text-xs"
                    value={runStatusFilter}
                    onChange={(e) => setRunStatusFilter(e.target.value)}
                  >
                    <option value="all">All statuses</option>
                    <option value="running">Running</option>
                    <option value="queued">Queued</option>
                    <option value="success">Success</option>
                    <option value="partial_success">Partial Success</option>
                    <option value="failed">Failed</option>
                  </select>
                  <select
                    className="rounded border border-white/[0.08] bg-background px-2 py-1 text-xs"
                    value={selectedScheduleId}
                    onChange={(e) => setSelectedScheduleId(e.target.value)}
                  >
                    <option value="all">All schedules</option>
                    {schedules.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto rounded border border-white/[0.08]">
                <table className="w-full text-xs sm:text-sm">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="px-2 py-2 text-left">Run</th>
                      <th className="px-2 py-2 text-left">Status</th>
                      <th className="px-2 py-2 text-left">Trigger</th>
                      <th className="px-2 py-2 text-left">Started</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr
                        key={r.id}
                        className={`border-t border-white/[0.06] cursor-pointer ${selectedRunId === r.id ? "bg-white/[0.03]" : ""}`}
                        onClick={() => loadRunDetail(r.id)}
                      >
                        <td className="px-2 py-2 font-mono text-[10px]">{r.id.slice(0, 8)}</td>
                        <td className="px-2 py-2">
                          <span className={`inline-block rounded border px-2 py-0.5 text-[10px] uppercase tracking-wider ${getRunBadgeClass(r.status)}`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-xs">{r.trigger_source}</td>
                        <td className="px-2 py-2 whitespace-nowrap">{formatTs(r.started_at || r.created_at)}</td>
                      </tr>
                    ))}
                    {runs.length === 0 && !loadingConsole && (
                      <tr>
                        <td className="px-2 py-3 text-muted-foreground" colSpan={4}>No runs found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {(consoleMessage || message) && (
            <p className={`text-xs ${(consoleMessage || message || "").includes("Failed") ? "text-red-400" : "text-green-400"}`}>
              {consoleMessage || message}
            </p>
          )}

          <div className="rounded-lg border border-white/[0.08] p-3">
            <h3 className="text-sm font-semibold mb-2">Run Detail</h3>
            {loadingRunDetail && <p className="text-xs text-muted-foreground">Loading run detail...</p>}
            {!loadingRunDetail && !runDetail && <p className="text-xs text-muted-foreground">Select a run to inspect task execution and log references.</p>}
            {!loadingRunDetail && runDetail && (
              <div className="space-y-3 text-xs">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <div className="text-muted-foreground/70">Run ID</div>
                    <div className="font-mono">{runDetail.run.id}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground/70">Schedule</div>
                    <div>{runDetail.schedule?.name || runDetail.run.schedule_id}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground/70">Status</div>
                    <div>{runDetail.run.status}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground/70">Duration</div>
                    <div>{formatTs(runDetail.run.started_at)} - {formatTs(runDetail.run.finished_at)}</div>
                  </div>
                </div>

                <div className="overflow-x-auto rounded border border-white/[0.08]">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/30">
                      <tr>
                        <th className="px-2 py-2 text-left">Task Run</th>
                        <th className="px-2 py-2 text-left">Status</th>
                        <th className="px-2 py-2 text-left">Start</th>
                        <th className="px-2 py-2 text-left">Finish</th>
                        <th className="px-2 py-2 text-left">Log Ref</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runDetail.task_runs.map((taskRun) => (
                        <tr key={taskRun.id} className="border-t border-white/[0.06]">
                          <td className="px-2 py-2 font-mono">{taskRun.id.slice(0, 8)}</td>
                          <td className="px-2 py-2">
                            <span className={`inline-block rounded border px-2 py-0.5 text-[10px] uppercase tracking-wider ${getRunBadgeClass(taskRun.status)}`}>
                              {taskRun.status}
                            </span>
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap">{formatTs(taskRun.started_at)}</td>
                          <td className="px-2 py-2 whitespace-nowrap">{formatTs(taskRun.finished_at)}</td>
                          <td className="px-2 py-2 font-mono">{taskRun.log_ref || "-"}</td>
                        </tr>
                      ))}
                      {runDetail.task_runs.length === 0 && (
                        <tr>
                          <td className="px-2 py-3 text-muted-foreground" colSpan={5}>No task runs were recorded for this run.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

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
