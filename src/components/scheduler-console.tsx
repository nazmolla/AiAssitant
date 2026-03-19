"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { processMessages, type Message } from "@/components/chat-panel-types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import Collapse from "@mui/material/Collapse";

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
  handler_type?: string;
  owner_type?: string;
  owner_id?: string | null;
  retry_policy_json?: string | null;
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
  output_json: string | null;
}

interface SchedulerRunDetailResponse {
  run: SchedulerRunRecord;
  schedule: SchedulerScheduleRecord | null;
  task_runs: SchedulerTaskRunRecord[];
}

interface SchedulerTaskRecord {
  id: string;
  task_key: string;
  name: string;
  handler_name: string;
  execution_mode: string;
  sequence_no: number;
  depends_on_task_id?: string | null;
  depends_on_task_key?: string | null;
  config_json?: string | null;
  enabled: number;
}

interface SchedulerScheduleDetailResponse {
  schedule: SchedulerScheduleRecord;
  tasks: SchedulerTaskRecord[];
  recent_runs: SchedulerRunRecord[];
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  hasMore: boolean;
}

function parseTaskConfig(configJson?: string | null): { task_type: "handler" | "prompt"; prompt?: string } {
  if (!configJson) return { task_type: "handler" };
  try {
    const parsed = JSON.parse(configJson) as { task_type?: unknown; prompt?: unknown };
    return {
      task_type: parsed.task_type === "prompt" ? "prompt" : "handler",
      prompt: typeof parsed.prompt === "string" ? parsed.prompt : undefined,
    };
  } catch {
    return { task_type: "handler" };
  }
}

function normalizeIntervalExprInput(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return value.trim();

  const strict = /^every:(\d+):(second|minute|hour|day|week|month)$/i.exec(trimmed);
  if (strict) return `every:${Math.max(1, Number(strict[1]))}:${strict[2]}`;

  const missingColon = /^every:(\d+)(second|minute|hour|day|week|month)$/i.exec(trimmed);
  if (missingColon) return `every:${Math.max(1, Number(missingColon[1]))}:${missingColon[2]}`;

  const spaced = /^every\s+(\d+)\s*(second|minute|hour|day|week|month)s?$/i.exec(trimmed);
  if (spaced) return `every:${Math.max(1, Number(spaced[1]))}:${spaced[2]}`;

  const short = /^(\d+)\s*(second|minute|hour|day|week|month)s?$/i.exec(trimmed);
  if (short) return `every:${Math.max(1, Number(short[1]))}:${short[2]}`;

  return value.trim();
}

const INTERVAL_OPTIONS: { value: string; label: string }[] = [
  { value: "every:1:minute", label: "Every 1 minute" },
  { value: "every:2:minute", label: "Every 2 minutes" },
  { value: "every:5:minute", label: "Every 5 minutes" },
  { value: "every:10:minute", label: "Every 10 minutes" },
  { value: "every:15:minute", label: "Every 15 minutes" },
  { value: "every:30:minute", label: "Every 30 minutes" },
  { value: "every:1:hour", label: "Every 1 hour" },
  { value: "every:2:hour", label: "Every 2 hours" },
  { value: "every:6:hour", label: "Every 6 hours" },
  { value: "every:12:hour", label: "Every 12 hours" },
  { value: "every:1:day", label: "Every day" },
  { value: "every:1:week", label: "Every week" },
];

const CRON_OPTIONS: { value: string; label: string }[] = [
  { value: "* * * * *", label: "Every minute" },
  { value: "*/5 * * * *", label: "Every 5 minutes" },
  { value: "*/15 * * * *", label: "Every 15 minutes" },
  { value: "*/30 * * * *", label: "Every 30 minutes" },
  { value: "0 * * * *", label: "Every hour (on the hour)" },
  { value: "0 */2 * * *", label: "Every 2 hours" },
  { value: "0 */6 * * *", label: "Every 6 hours" },
  { value: "0 0 * * *", label: "Daily at midnight" },
  { value: "0 9 * * 1-5", label: "Weekdays at 9am" },
  { value: "0 0 * * 0", label: "Weekly on Sunday" },
];

export function SchedulerConsole() {
  const { formatDate } = useTheme();
  const [selectedScheduleIds, setSelectedScheduleIds] = useState<string[]>([]);
  const [overview, setOverview] = useState<SchedulerOverview | null>(null);
  const [schedules, setSchedules] = useState<SchedulerScheduleRecord[]>([]);
  const [runs, setRuns] = useState<SchedulerRunRecord[]>([]);
  const [loadingConsole, setLoadingConsole] = useState(true);
  const [consoleMessage, setConsoleMessage] = useState<string | null>(null);
  const [runStatusFilter, setRunStatusFilter] = useState<string>("all");
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const [focusedView, setFocusedView] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<SchedulerRunDetailResponse | null>(null);
  const [loadingRunDetail, setLoadingRunDetail] = useState(false);
  const [expandedTaskRunIds, setExpandedTaskRunIds] = useState<Set<string>>(new Set());
  const [expandedThreadViewIds, setExpandedThreadViewIds] = useState<Set<string>>(new Set());
  const [threadMessagesCache, setThreadMessagesCache] = useState<Map<string, Message[]>>(new Map());
  const [loadingThreadIds, setLoadingThreadIds] = useState<Set<string>>(new Set());
  const [selectedScheduleDetail, setSelectedScheduleDetail] = useState<SchedulerScheduleDetailResponse | null>(null);
  const [loadingScheduleDetail, setLoadingScheduleDetail] = useState(false);
  const [savingDetail, setSavingDetail] = useState(false);
  const [detailName, setDetailName] = useState("");
  const [detailTriggerType, setDetailTriggerType] = useState<"cron" | "interval" | "once">("interval");
  const [detailTriggerExpr, setDetailTriggerExpr] = useState("");
  const [detailTasks, setDetailTasks] = useState<Array<{
    id?: string;
    task_key: string;
    name: string;
    handler_name: string;
    task_type?: "handler" | "prompt";
    prompt?: string;
    depends_on_task_key?: string | null;
    execution_mode: "sync" | "async" | "fanout";
    sequence_no: number;
    enabled: number;
  }>>([]);
  const focusedRunsVisibleRows = 5;
  const focusedRunsRowHeightPx = 38;

  const loadThreadMessages = useCallback(async (threadId: string) => {
    if (threadMessagesCache.has(threadId) || loadingThreadIds.has(threadId)) return;
    setLoadingThreadIds((prev) => new Set([...prev, threadId]));
    try {
      const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}`);
      if (res.ok) {
        const data = await res.json() as { messages: Message[] };
        setThreadMessagesCache((prev) => new Map([...prev, [threadId, data.messages ?? []]]));
      }
    } catch {
      // silently ignore — thread may be from a different user or no longer exist
    } finally {
      setLoadingThreadIds((prev) => { const next = new Set(prev); next.delete(threadId); return next; });
    }
  }, [threadMessagesCache, loadingThreadIds]);

  const toggleThreadView = useCallback((threadId: string) => {
    setExpandedThreadViewIds((prev) => {
      const next = new Set(prev);
      if (next.has(threadId)) { next.delete(threadId); } else { next.add(threadId); loadThreadMessages(threadId); }
      return next;
    });
  }, [loadThreadMessages]);

  const toggleScheduleSelection = (id: string) => {
    setSelectedScheduleIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const clearScheduleSelection = () => setSelectedScheduleIds([]);

  const visibleScheduleIds = schedules.map((s) => s.id);
  const allVisibleSelected = visibleScheduleIds.length > 0 && visibleScheduleIds.every((id) => selectedScheduleIds.includes(id));

  const toggleSelectAllSchedules = () => {
    setSelectedScheduleIds((prev) => {
      if (allVisibleSelected) {
        return prev.filter((id) => !visibleScheduleIds.includes(id));
      }
      const next = new Set(prev);
      for (const id of visibleScheduleIds) next.add(id);
      return Array.from(next);
    });
  };

  const formatTs = (value: string | null) => {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return formatDate(value, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const getRunBadgeClass = (status: string) => {
    if (["queued", "claimed", "running", "retrying"].includes(status)) return "bg-blue-500/20 text-blue-300 border-blue-400/40";
    if (["success"].includes(status)) return "bg-green-500/20 text-green-300 border-green-400/40";
    if (["partial_success"].includes(status)) return "bg-amber-500/20 text-amber-300 border-amber-400/40";
    if (["failed", "timeout", "cancelled"].includes(status)) return "bg-red-500/20 text-red-300 border-red-400/40";
    return "bg-slate-500/20 text-slate-300 border-slate-400/40";
  };

  const getScheduleBadgeClass = (status: ScheduleStatus) => {
    if (status === "active") return "bg-green-500/20 text-green-300 border-green-400/40";
    if (status === "paused") return "bg-amber-500/20 text-amber-300 border-amber-400/40";
    return "bg-slate-500/20 text-slate-300 border-slate-400/40";
  };

  const loadConsole = async () => {
    setLoadingConsole(true);
    setConsoleMessage(null);
    try {
      const schedulesUrl = new URL("/api/scheduler/schedules", window.location.origin);
      schedulesUrl.searchParams.set("limit", "30");

      const [overviewRes, schedulesRes] = await Promise.all([
        fetch("/api/scheduler/overview"),
        fetch(schedulesUrl.toString()),
      ]);

      const [overviewJson, schedulesJson] = await Promise.all([
        overviewRes.json().catch(() => ({})),
        schedulesRes.json().catch(() => ({})),
      ]);

      if (!overviewRes.ok || !schedulesRes.ok) {
        setConsoleMessage(
          (overviewJson as { error?: string }).error ||
          (schedulesJson as { error?: string }).error ||
          "Failed to load scheduler console."
        );
        return;
      }

      setOverview(overviewJson as SchedulerOverview);
      const nextSchedules = ((schedulesJson as PaginatedResponse<SchedulerScheduleRecord>).data || []).slice(0, 20);
      setSchedules(nextSchedules);

      setSelectedScheduleId((prev) => {
        if (nextSchedules.length === 0) return null;
        if (!prev) return nextSchedules[0].id;
        const stillExists = nextSchedules.some((schedule) => schedule.id === prev);
        return stillExists ? prev : nextSchedules[0].id;
      });
    } catch {
      setConsoleMessage("Failed to load scheduler console.");
    } finally {
      setLoadingConsole(false);
    }
  };

  const loadScheduleDetail = async (scheduleId: string) => {
    if (!scheduleId) {
      setSelectedScheduleDetail(null);
      return;
    }
    setLoadingScheduleDetail(true);
    try {
      const res = await fetch(`/api/scheduler/schedules/${scheduleId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConsoleMessage((data as { error?: string }).error || "Failed to load schedule detail.");
        setSelectedScheduleDetail(null);
        return;
      }
      setSelectedScheduleDetail(data as SchedulerScheduleDetailResponse);
    } catch {
      setConsoleMessage("Failed to load schedule detail.");
      setSelectedScheduleDetail(null);
    } finally {
      setLoadingScheduleDetail(false);
    }
  };

  const loadFocusedRuns = async (scheduleId: string) => {
    if (!scheduleId) {
      setRuns([]);
      return;
    }
    try {
      const runsUrl = new URL("/api/scheduler/runs", window.location.origin);
      runsUrl.searchParams.set("limit", "100");
      runsUrl.searchParams.set("scheduleId", scheduleId);
      if (runStatusFilter !== "all") runsUrl.searchParams.set("status", runStatusFilter);
      const res = await fetch(runsUrl.toString());
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConsoleMessage((json as { error?: string }).error || "Failed to load schedule runs.");
        return;
      }
      setRuns(((json as PaginatedResponse<SchedulerRunRecord>).data || []).slice(0, 100));
    } catch {
      setConsoleMessage("Failed to load schedule runs.");
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

  const openFocusedView = () => {
    if (!selectedScheduleDetail?.schedule) return;
    const idToTaskKey = new Map(selectedScheduleDetail.tasks.map((task) => [task.id, task.task_key]));
    setDetailName(selectedScheduleDetail.schedule.name);
    setDetailTriggerType(selectedScheduleDetail.schedule.trigger_type as "cron" | "interval" | "once");
    setDetailTriggerExpr(selectedScheduleDetail.schedule.trigger_expr);
    setDetailTasks(
      selectedScheduleDetail.tasks.map((task) => {
        const config = parseTaskConfig(task.config_json);
        return {
          id: task.id,
          task_key: task.task_key,
          name: task.name,
          handler_name: config.task_type === "prompt" ? "agent.prompt" : task.handler_name,
          task_type: config.task_type,
          prompt: config.prompt || "",
          depends_on_task_key: task.depends_on_task_key ?? (task.depends_on_task_id ? (idToTaskKey.get(task.depends_on_task_id) || null) : null),
          execution_mode: (task.execution_mode as "sync" | "async" | "fanout") || "sync",
          sequence_no: task.sequence_no,
          enabled: task.enabled,
        };
      })
    );
    setFocusedView(true);
    setSelectedRunId(null);
    setRunDetail(null);
  };

  const saveFocusedDetails = async () => {
    if (!selectedScheduleDetail?.schedule) return;
    setSavingDetail(true);
    setConsoleMessage(null);
    try {
      const id = selectedScheduleDetail.schedule.id;
      const normalizedTriggerExpr = detailTriggerType === "interval"
        ? normalizeIntervalExprInput(detailTriggerExpr)
        : detailTriggerExpr.trim();
      const scheduleRes = await fetch(`/api/scheduler/schedules/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: detailName.trim(),
          trigger_type: detailTriggerType,
          trigger_expr: normalizedTriggerExpr,
        }),
      });
      const scheduleJson = await scheduleRes.json().catch(() => ({}));
      if (!scheduleRes.ok) {
        setConsoleMessage((scheduleJson as { error?: string }).error || "Failed to update schedule.");
        return;
      }
      const returnedExpr = (scheduleJson as { schedule?: { trigger_expr?: string } }).schedule?.trigger_expr;
      if (typeof returnedExpr === "string") {
        setDetailTriggerExpr(returnedExpr);
      }

      const tasksRes = await fetch(`/api/scheduler/schedules/${id}/tasks`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          replace: true,
          tasks: detailTasks.map((t, index) => ({
            id: t.id,
            task_key: t.task_key.trim(),
            name: t.name.trim(),
            handler_name: t.handler_name.trim(),
            task_type: t.task_type === "prompt" ? "prompt" : "handler",
            prompt: t.task_type === "prompt" ? (t.prompt || "") : undefined,
            depends_on_task_key: t.depends_on_task_key || null,
            execution_mode: t.execution_mode,
            sequence_no: Number.isFinite(t.sequence_no) ? t.sequence_no : index,
            enabled: t.enabled === 0 ? 0 : 1,
          })),
        }),
      });
      const tasksJson = await tasksRes.json().catch(() => ({}));
      if (!tasksRes.ok) {
        setConsoleMessage((tasksJson as { error?: string }).error || "Failed to update subtasks.");
        return;
      }

      setConsoleMessage("Schedule details updated.");
      await loadConsole();
      await loadScheduleDetail(id);
    } catch {
      setConsoleMessage("Failed to update schedule details.");
    } finally {
      setSavingDetail(false);
    }
  };

  const deleteSelectedSchedule = async () => {
    if (!selectedScheduleDetail?.schedule) return;
    const ok = window.confirm("Delete this schedule and all subtasks/runs? This action cannot be undone.");
    if (!ok) return;

    setSavingDetail(true);
    setConsoleMessage(null);
    try {
      const id = selectedScheduleDetail.schedule.id;
      const res = await fetch(`/api/scheduler/schedules/${id}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConsoleMessage((json as { error?: string }).error || "Failed to delete schedule.");
        return;
      }
      setFocusedView(false);
      setSelectedScheduleId(null);
      setSelectedScheduleDetail(null);
      setRuns([]);
      setRunDetail(null);
      setSelectedRunId(null);
      setConsoleMessage("Schedule deleted with cascade.");
      await loadConsole();
    } catch {
      setConsoleMessage("Failed to delete schedule.");
    } finally {
      setSavingDetail(false);
    }
  };

  const bulkDeleteSchedules = async () => {
    if (selectedScheduleIds.length === 0) return;
    const ok = window.confirm(`Delete ${selectedScheduleIds.length} selected schedules with cascade? This cannot be undone.`);
    if (!ok) return;

    setSavingDetail(true);
    setConsoleMessage(null);
    try {
      const results = await Promise.all(
        selectedScheduleIds.map(async (id) => {
          const res = await fetch(`/api/scheduler/schedules/${id}`, { method: "DELETE" });
          return { id, ok: res.ok };
        })
      );
      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        setConsoleMessage(`Deleted ${results.length - failed.length}/${results.length} schedules. ${failed.length} failed.`);
      } else {
        setConsoleMessage(`Deleted ${results.length} schedules with cascade.`);
      }

      setFocusedView(false);
      setSelectedScheduleId(null);
      setSelectedScheduleDetail(null);
      setRuns([]);
      setRunDetail(null);
      setSelectedRunId(null);
      clearScheduleSelection();
      await loadConsole();
    } catch {
      setConsoleMessage("Failed to delete selected schedules.");
    } finally {
      setSavingDetail(false);
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

  useEffect(() => {
    loadConsole();
  }, []);

  useEffect(() => {
    if (!selectedScheduleId) return;
    loadScheduleDetail(selectedScheduleId);
  }, [selectedScheduleId]);

  useEffect(() => {
    if (!focusedView || !selectedScheduleId) return;
    loadFocusedRuns(selectedScheduleId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadFocusedRuns is recreated each render; adding it would cause an infinite fetch loop
  }, [focusedView, selectedScheduleId, runStatusFilter]);

  useEffect(() => {
    if (!focusedView) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setFocusedView(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [focusedView]);

  return (
    <div className="w-full space-y-4">
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

          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground/80">Header Tasks</h3>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={loadConsole}>Refresh</Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={toggleSelectAllSchedules}
                  disabled={schedules.length === 0}
                >
                  {allVisibleSelected ? "Deselect All" : "Select All"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={bulkDeleteSchedules}
                  disabled={selectedScheduleIds.length === 0 || savingDetail}
                >
                  Delete Selected ({selectedScheduleIds.length})
                </Button>
                {selectedScheduleIds.length > 0 && (
                  <Button variant="outline" size="sm" onClick={clearScheduleSelection}>Clear Selection</Button>
                )}
              </div>
            </div>

            <div className="max-w-full overflow-x-auto rounded-lg border border-white/[0.08] bg-white/[0.01]">
              <table className="w-full table-fixed text-xs sm:text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="w-[5%] px-2 py-2 text-left">
                      <input
                        type="checkbox"
                        aria-label="Select all schedules"
                        checked={allVisibleSelected}
                        disabled={schedules.length === 0}
                        onChange={toggleSelectAllSchedules}
                        className="h-4 w-4 cursor-pointer accent-primary align-middle disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </th>
                    <th className="w-[36%] px-3 py-2 text-left">Header Task</th>
                    <th className="hidden w-[18%] px-3 py-2 text-left md:table-cell">Schedule Key</th>
                    <th className="w-[14%] px-3 py-2 text-left">Status</th>
                    <th className="hidden w-[16%] px-3 py-2 text-left lg:table-cell">Trigger</th>
                    <th className="hidden w-[12%] px-3 py-2 text-left sm:table-cell">Next Run</th>
                    <th className="w-[22%] px-3 py-2 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {schedules.map((s) => {
                    const isOpen = !focusedView && selectedScheduleId === s.id;
                    const hasDetail = selectedScheduleDetail?.schedule?.id === s.id;
                    return (
                      <Fragment key={s.id}>
                        <tr
                          className={`cursor-pointer border-t border-white/[0.06] transition ${isOpen ? "bg-primary/10" : "hover:bg-white/[0.03]"}`}
                          onClick={() => {
                            setSelectedScheduleId((prev) => (prev === s.id ? null : s.id));
                            setFocusedView(false);
                            setSelectedRunId(null);
                            setRunDetail(null);
                          }}
                        >
                          <td className="px-2 py-2">
                            <input
                              type="checkbox"
                              checked={selectedScheduleIds.includes(s.id)}
                              onClick={(e) => e.stopPropagation()}
                              onChange={() => toggleScheduleSelection(s.id)}
                              className="h-4 w-4 cursor-pointer accent-primary align-middle"
                            />
                          </td>
                          <td className="px-3 py-2 font-medium">
                            <div className="truncate whitespace-nowrap" title={s.name}>{s.name}</div>
                          </td>
                          <td className="hidden px-3 py-2 font-mono text-[10px] text-muted-foreground/80 md:table-cell">
                            <div className="truncate whitespace-nowrap" title={s.schedule_key}>{s.schedule_key}</div>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`inline-block rounded border px-2 py-0.5 text-[10px] uppercase tracking-wider ${getScheduleBadgeClass(s.status)}`}>
                              {s.status}
                            </span>
                          </td>
                          <td className="hidden px-3 py-2 lg:table-cell"><div className="truncate whitespace-nowrap" title={`${s.trigger_type} / ${s.trigger_expr}`}>{s.trigger_type} / {s.trigger_expr}</div></td>
                          <td className="hidden px-3 py-2 whitespace-nowrap sm:table-cell">{formatTs(s.next_run_at)}</td>
                          <td className="px-3 py-2 text-[11px] text-muted-foreground/80">Tap row to {isOpen ? "collapse" : "expand"}</td>
                        </tr>

                        {isOpen && (
                          <tr className="border-t border-white/[0.06] bg-white/[0.02]">
                            <td className="px-3 py-3" colSpan={7}>
                              {!hasDetail && loadingScheduleDetail && (
                                <p className="text-xs text-muted-foreground">Loading inline details...</p>
                              )}

                              {hasDetail && selectedScheduleDetail && (
                                <div className="rounded-lg border border-white/[0.08] bg-white/[0.01] p-3 sm:p-4">
                                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground/80">Inline Detail: {selectedScheduleDetail.schedule.name}</h3>
                                    <div className="grid w-full grid-cols-1 gap-1 sm:w-auto sm:grid-cols-3 xl:flex">
                                      {selectedScheduleDetail.schedule.status === "active" ? (
                                        <Button className="w-full xl:w-auto" variant="outline" size="sm" onClick={() => controlSchedule(selectedScheduleDetail.schedule.id, "pause")}>Pause</Button>
                                      ) : (
                                        <Button className="w-full xl:w-auto" variant="outline" size="sm" onClick={() => controlSchedule(selectedScheduleDetail.schedule.id, "resume")}>Resume</Button>
                                      )}
                                      <Button className="w-full xl:w-auto" size="sm" onClick={() => controlSchedule(selectedScheduleDetail.schedule.id, "trigger")}>Trigger</Button>
                                      <Button className="w-full xl:w-auto" variant="outline" size="sm" onClick={openFocusedView}>Open Full Details</Button>
                                    </div>
                                  </div>

                                  <div className="grid gap-4 lg:grid-cols-2">
                                    <div>
                                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">Subtasks</h4>
                                      <div className="overflow-x-auto rounded border border-white/[0.08]">
                                        <table className="w-full text-xs">
                                          <thead className="bg-muted/30">
                                            <tr>
                                              <th className="px-2 py-2 text-left">#</th>
                                              <th className="px-2 py-2 text-left">Task</th>
                                              <th className="px-2 py-2 text-left">Handler</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {selectedScheduleDetail.tasks.map((task) => (
                                              <tr key={task.id} className="border-t border-white/[0.06]">
                                                <td className="px-2 py-2">{task.sequence_no}</td>
                                                <td className="px-2 py-2">
                                                  <div className="font-medium">{task.name}</div>
                                                  <div className="font-mono text-[10px] text-muted-foreground/70">{task.task_key}</div>
                                                </td>
                                                <td className="px-2 py-2 font-mono text-[10px]">{task.handler_name}</td>
                                              </tr>
                                            ))}
                                            {selectedScheduleDetail.tasks.length === 0 && (
                                              <tr><td className="px-2 py-2 text-muted-foreground" colSpan={3}>No subtasks.</td></tr>
                                            )}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>

                                    <div>
                                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">Previous Runs</h4>
                                      <div className="overflow-x-auto rounded border border-white/[0.08]">
                                        <table className="w-full text-xs">
                                          <thead className="bg-muted/30">
                                            <tr>
                                              <th className="px-2 py-2 text-left">Run</th>
                                              <th className="px-2 py-2 text-left">Status</th>
                                              <th className="px-2 py-2 text-left">Started</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {selectedScheduleDetail.recent_runs.slice(0, 6).map((r) => (
                                              <tr key={r.id} className="border-t border-white/[0.06]">
                                                <td className="px-2 py-2 font-mono text-[10px]">{r.id.slice(0, 8)}</td>
                                                <td className="px-2 py-2">
                                                  <span className={`inline-block rounded border px-2 py-0.5 text-[10px] uppercase tracking-wider ${getRunBadgeClass(r.status)}`}>
                                                    {r.status}
                                                  </span>
                                                </td>
                                                <td className="px-2 py-2 whitespace-nowrap">{formatTs(r.started_at || r.created_at)}</td>
                                              </tr>
                                            ))}
                                            {selectedScheduleDetail.recent_runs.length === 0 && (
                                              <tr><td className="px-2 py-2 text-muted-foreground" colSpan={3}>No previous runs.</td></tr>
                                            )}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                  {schedules.length === 0 && (
                    <tr>
                      <td className="px-3 py-3 text-muted-foreground" colSpan={7}>No header tasks found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {selectedScheduleDetail?.schedule && focusedView && (
              <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 sm:p-8" role="dialog" aria-modal="true">
                <div className="max-h-[95vh] w-full max-w-6xl overflow-y-auto rounded-xl border border-primary/30 bg-background p-4 sm:p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-primary">Focused Header View: {selectedScheduleDetail.schedule.name}</h3>
                    <div className="flex w-full flex-wrap gap-1 sm:w-auto">
                      <Button className="w-full sm:w-auto" variant="outline" size="sm" onClick={() => setFocusedView(false)}>Close</Button>
                      <Button
                        className="w-full sm:w-auto"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (selectedScheduleId) {
                            loadFocusedRuns(selectedScheduleId);
                            loadScheduleDetail(selectedScheduleId);
                          }
                        }}
                      >
                        Refresh
                      </Button>
                      <select
                        className="w-full rounded border border-white/[0.08] bg-background px-2 py-1 text-xs sm:w-auto"
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
                    </div>
                  </div>

                  <div className="mb-4 rounded border border-white/[0.08] p-3">
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">Edit Schedule</h4>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <input
                        className="rounded border border-white/[0.08] bg-background px-2 py-1 text-xs"
                        value={detailName}
                        onChange={(e) => setDetailName(e.target.value)}
                        placeholder="Schedule name"
                      />
                      <select
                        className="rounded border border-white/[0.08] bg-background px-2 py-1 text-xs"
                        value={detailTriggerType}
                        onChange={(e) => {
                          const newType = e.target.value as "cron" | "interval" | "once";
                          setDetailTriggerType(newType);
                          if (newType === "interval") setDetailTriggerExpr("every:10:minute");
                          else if (newType === "cron") setDetailTriggerExpr("0 * * * *");
                          else setDetailTriggerExpr("");
                        }}
                      >
                        <option value="interval">interval</option>
                        <option value="cron">cron</option>
                        <option value="once">once</option>
                      </select>
                      {detailTriggerType === "interval" ? (
                        <select
                          className="rounded border border-white/[0.08] bg-background px-2 py-1 text-xs"
                          value={detailTriggerExpr}
                          onChange={(e) => setDetailTriggerExpr(e.target.value)}
                        >
                          {detailTriggerExpr && !INTERVAL_OPTIONS.some((o) => o.value === detailTriggerExpr) && (
                            <option value={detailTriggerExpr}>{detailTriggerExpr}</option>
                          )}
                          {INTERVAL_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      ) : detailTriggerType === "cron" ? (
                        <select
                          className="rounded border border-white/[0.08] bg-background px-2 py-1 text-xs"
                          value={detailTriggerExpr}
                          onChange={(e) => setDetailTriggerExpr(e.target.value)}
                        >
                          {detailTriggerExpr && !CRON_OPTIONS.some((o) => o.value === detailTriggerExpr) && (
                            <option value={detailTriggerExpr}>{detailTriggerExpr}</option>
                          )}
                          {CRON_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="rounded border border-white/[0.08] bg-background px-2 py-1 text-xs"
                          value={detailTriggerExpr}
                          onChange={(e) => setDetailTriggerExpr(e.target.value)}
                          placeholder="ISO 8601 datetime"
                        />
                      )}
                    </div>

                    <div className="mt-3 overflow-x-auto rounded border border-white/[0.08]">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/30">
                          <tr>
                            <th className="px-2 py-2 text-left">#</th>
                            <th className="px-2 py-2 text-left">Task Key</th>
                            <th className="px-2 py-2 text-left">Task Name</th>
                            <th className="px-2 py-2 text-left">Type</th>
                            <th className="px-2 py-2 text-left">Handler</th>
                            <th className="px-2 py-2 text-left">Depends On</th>
                            <th className="px-2 py-2 text-left">Mode</th>
                            <th className="px-2 py-2 text-left">Enabled</th>
                            <th className="px-2 py-2 text-left">Remove</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailTasks.map((task, idx) => (
                            <Fragment key={task.id || `${task.task_key}-${idx}`}>
                            <tr className="border-t border-white/[0.06]">
                              <td className="px-2 py-2">
                                <input
                                  className="w-14 rounded border border-white/[0.08] bg-background px-1 py-1"
                                  type="number"
                                  value={task.sequence_no}
                                  onChange={(e) => {
                                    const next = [...detailTasks];
                                    next[idx] = { ...next[idx], sequence_no: Number(e.target.value) || 0 };
                                    setDetailTasks(next);
                                  }}
                                />
                              </td>
                              <td className="px-2 py-2">
                                <input
                                  className="w-full rounded border border-white/[0.08] bg-background px-1 py-1"
                                  value={task.task_key}
                                  onChange={(e) => {
                                    const next = [...detailTasks];
                                    next[idx] = { ...next[idx], task_key: e.target.value };
                                    setDetailTasks(next);
                                  }}
                                />
                              </td>
                              <td className="px-2 py-2">
                                <input
                                  className="w-full rounded border border-white/[0.08] bg-background px-1 py-1"
                                  value={task.name}
                                  onChange={(e) => {
                                    const next = [...detailTasks];
                                    next[idx] = { ...next[idx], name: e.target.value };
                                    setDetailTasks(next);
                                  }}
                                />
                              </td>
                              <td className="px-2 py-2">
                                <select
                                  className="rounded border border-white/[0.08] bg-background px-1 py-1"
                                  value={task.task_type || "handler"}
                                  onChange={(e) => {
                                    const next = [...detailTasks];
                                    const taskType = e.target.value === "prompt" ? "prompt" : "handler";
                                    next[idx] = {
                                      ...next[idx],
                                      task_type: taskType,
                                      handler_name: taskType === "prompt" ? "agent.prompt" : next[idx].handler_name,
                                    };
                                    setDetailTasks(next);
                                  }}
                                >
                                  <option value="handler">handler</option>
                                  <option value="prompt">prompt</option>
                                </select>
                              </td>
                              <td className="px-2 py-2">
                                <input
                                  className="w-full rounded border border-white/[0.08] bg-background px-1 py-1"
                                  value={task.handler_name}
                                  disabled={(task.task_type || "handler") === "prompt"}
                                  onChange={(e) => {
                                    const next = [...detailTasks];
                                    next[idx] = { ...next[idx], handler_name: e.target.value };
                                    setDetailTasks(next);
                                  }}
                                />
                              </td>
                              <td className="px-2 py-2">
                                <select
                                  className="w-full rounded border border-white/[0.08] bg-background px-1 py-1"
                                  value={task.depends_on_task_key || ""}
                                  onChange={(e) => {
                                    const next = [...detailTasks];
                                    next[idx] = { ...next[idx], depends_on_task_key: e.target.value || null };
                                    setDetailTasks(next);
                                  }}
                                >
                                  <option value="">No dependency</option>
                                  {detailTasks.filter((_, depIdx) => depIdx !== idx).map((depTask) => (
                                    <option key={`${depTask.task_key}-${depTask.sequence_no}`} value={depTask.task_key}>{depTask.task_key}</option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-2 py-2">
                                <select
                                  className="rounded border border-white/[0.08] bg-background px-1 py-1"
                                  value={task.execution_mode}
                                  onChange={(e) => {
                                    const next = [...detailTasks];
                                    next[idx] = { ...next[idx], execution_mode: e.target.value as "sync" | "async" | "fanout" };
                                    setDetailTasks(next);
                                  }}
                                >
                                  <option value="sync">sync</option>
                                  <option value="async">async</option>
                                  <option value="fanout">fanout</option>
                                </select>
                              </td>
                              <td className="px-2 py-2">
                                <input
                                  type="checkbox"
                                  checked={task.enabled === 1}
                                  onChange={(e) => {
                                    const next = [...detailTasks];
                                    next[idx] = { ...next[idx], enabled: e.target.checked ? 1 : 0 };
                                    setDetailTasks(next);
                                  }}
                                />
                              </td>
                              <td className="px-2 py-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setDetailTasks(detailTasks.filter((_, i) => i !== idx))}
                                >
                                  Remove
                                </Button>
                              </td>
                            </tr>
                          {((task.task_type || "handler") === "prompt") && (
                            <tr className="border-t border-white/[0.06]">
                              <td className="px-2 py-2 text-[10px] text-muted-foreground" colSpan={9}>Prompt</td>
                            </tr>
                          )}
                          {((task.task_type || "handler") === "prompt") && (
                            <tr className="border-t border-white/[0.06]">
                              <td className="px-2 py-2" colSpan={9}>
                                <textarea
                                  className="w-full rounded border border-white/[0.08] bg-background px-2 py-1 text-xs"
                                  value={task.prompt || ""}
                                  onChange={(e) => {
                                    const next = [...detailTasks];
                                    next[idx] = { ...next[idx], prompt: e.target.value };
                                    setDetailTasks(next);
                                  }}
                                  rows={3}
                                  placeholder="Prompt text"
                                />
                              </td>
                            </tr>
                          )}
                            </Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-2 grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                      <Button
                        className="w-full sm:w-auto"
                        variant="outline"
                        size="sm"
                        onClick={() => setDetailTasks([
                          ...detailTasks,
                          {
                            task_key: `task_${detailTasks.length + 1}`,
                            name: `Task ${detailTasks.length + 1}`,
                            handler_name: "",
                            task_type: "handler",
                            prompt: "",
                            depends_on_task_key: null,
                            execution_mode: "sync",
                            sequence_no: detailTasks.length,
                            enabled: 1,
                          },
                        ])}
                      >
                        Add Subtask
                      </Button>
                      <Button className="w-full sm:w-auto" size="sm" onClick={saveFocusedDetails} disabled={savingDetail}>Save Changes</Button>
                      <Button className="w-full sm:w-auto" variant="outline" size="sm" onClick={deleteSelectedSchedule} disabled={savingDetail}>Delete Schedule (Cascade)</Button>
                    </div>
                  </div>

                  <div
                    data-testid="focused-runs-scroll"
                    className="overflow-x-auto overflow-y-auto rounded border border-white/[0.08]"
                    style={{ maxHeight: `${focusedRunsVisibleRows * focusedRunsRowHeightPx + 44}px` }}
                  >
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
                            className={`border-t border-white/[0.06] cursor-pointer ${selectedRunId === r.id ? "bg-white/[0.04]" : ""}`}
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
                        {runs.length === 0 && (
                          <tr><td className="px-2 py-3 text-muted-foreground" colSpan={4}>No runs found for this header task.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-3 rounded border border-white/[0.08] p-3">
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground/70">Run Detail + Logs</h4>
                    {loadingRunDetail && <p className="text-xs text-muted-foreground">Loading run detail...</p>}
                    {!loadingRunDetail && !runDetail && <p className="text-xs text-muted-foreground">Select a run above to view task-run logs.</p>}
                    {!loadingRunDetail && runDetail && (
                      <div className="overflow-x-auto rounded border border-white/[0.08]">
                        <table className="w-full text-xs">
                          <thead className="bg-muted/30">
                            <tr>
                              <th className="px-2 py-2 text-left">Task Run</th>
                              <th className="px-2 py-2 text-left">Status</th>
                              <th className="px-2 py-2 text-left">Start</th>
                              <th className="px-2 py-2 text-left">Finish</th>
                              <th className="px-2 py-2 text-left">Log Link</th>
                            </tr>
                          </thead>
                          <tbody>
                            {runDetail.task_runs.map((taskRun) => {
                              const output = taskRun.output_json ? (() => { try { return JSON.parse(taskRun.output_json); } catch { return null; } })() : null;
                              const hasOutput = !!output;
                              const isExpanded = expandedTaskRunIds.has(taskRun.id);
                              return (
                                <Fragment key={taskRun.id}>
                                  <tr className="border-t border-white/[0.06]">
                                    <td className="px-2 py-2 font-mono">{taskRun.id.slice(0, 8)}</td>
                                    <td className="px-2 py-2">
                                      <span className={`inline-block rounded border px-2 py-0.5 text-[10px] uppercase tracking-wider ${getRunBadgeClass(taskRun.status)}`}>
                                        {taskRun.status}
                                      </span>
                                    </td>
                                    <td className="px-2 py-2 whitespace-nowrap">{formatTs(taskRun.started_at)}</td>
                                    <td className="px-2 py-2 whitespace-nowrap">{formatTs(taskRun.finished_at)}</td>
                                    <td className="px-2 py-2 space-x-2">
                                      <a
                                        className="text-primary underline"
                                        href={`/dashboard?dashboardView=details&logScheduleId=${encodeURIComponent(runDetail.run.schedule_id)}&logRunId=${encodeURIComponent(runDetail.run.id)}&logTaskRunId=${encodeURIComponent(taskRun.id)}`}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        Open Filtered Logs
                                      </a>
                                      {hasOutput && (
                                        <button
                                          className="text-primary underline"
                                          onClick={() => setExpandedTaskRunIds((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(taskRun.id)) next.delete(taskRun.id);
                                            else next.add(taskRun.id);
                                            return next;
                                          })}
                                        >
                                          {isExpanded ? "Hide Output" : "View Output"}
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                  {hasOutput && (
                                    <tr>
                                      <td colSpan={5} className="p-0">
                                        <Collapse in={isExpanded}>
                                          <div className="px-3 py-2 bg-muted/20 border-t border-white/[0.04] text-xs space-y-2">
                                            {/* Thread links */}
                                            {(() => {
                                              const threadIds: { label: string; id: string }[] = [];
                                              if (output.primaryThreadId) {
                                                threadIds.push({ label: "Primary", id: output.primaryThreadId });
                                              } else if (output.threadId) {
                                                threadIds.push({ label: "Thread", id: output.threadId });
                                              }
                                              if (output.followupThreadId) {
                                                threadIds.push({ label: "Follow-up", id: output.followupThreadId });
                                              }
                                              // email / job-scout per-step threads
                                              if (output.stepKey && output.threadId && !output.primaryThreadId) {
                                                const existing = threadIds.find((t) => t.id === output.threadId);
                                                if (!existing) threadIds.push({ label: output.stepKey, id: output.threadId });
                                              }
                                              return threadIds.map(({ label, id }) => (
                                                <div key={id}>
                                                  <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-muted-foreground">{label} Thread:</span>
                                                    <span className="font-mono">{id.slice(0, 12)}…</span>
                                                    <button
                                                      className="text-primary underline ml-1"
                                                      onClick={() => toggleThreadView(id)}
                                                    >
                                                      {expandedThreadViewIds.has(id) ? "Hide Messages" : "View Messages"}
                                                    </button>
                                                    {loadingThreadIds.has(id) && <span className="text-muted-foreground ml-1">Loading…</span>}
                                                  </div>
                                                  {expandedThreadViewIds.has(id) && (() => {
                                                    const msgs = threadMessagesCache.get(id) ?? [];
                                                    const processed = processMessages(msgs, false, []);
                                                    if (!processed.length) return (
                                                      <p className="text-muted-foreground pl-2 py-1">No messages found.</p>
                                                    );
                                                    return (
                                                      <div className="space-y-1 pl-2 max-h-96 overflow-y-auto border border-white/[0.06] rounded p-2 bg-muted/10">
                                                        {processed.map((pm) => (
                                                          <div key={pm.msg.id} className={`rounded p-1.5 text-[11px] ${pm.msg.role === "user" ? "bg-blue-500/10 border border-blue-500/20" : pm.msg.role === "assistant" ? "bg-green-500/10 border border-green-500/20" : "bg-muted/20 border border-white/[0.04]"}`}>
                                                            <span className={`font-semibold mr-1 uppercase text-[10px] ${pm.msg.role === "user" ? "text-blue-400" : pm.msg.role === "assistant" ? "text-green-400" : "text-muted-foreground"}`}>{pm.msg.role}</span>
                                                            {pm.thoughts.length > 0 && (
                                                              <span className="text-muted-foreground ml-1">[{pm.thoughts.reduce((acc, t) => acc + t.toolCalls.length, 0)} tool call(s)]</span>
                                                            )}
                                                            {pm.displayContent && (
                                                              <span className="whitespace-pre-wrap break-words">{pm.displayContent}</span>
                                                            )}
                                                          </div>
                                                        ))}
                                                      </div>
                                                    );
                                                  })()}
                                                </div>
                                              ));
                                            })()}
                                            {/* Tools used */}
                                            {output.toolsUsed && output.toolsUsed.length > 0 && (
                                              <p><span className="text-muted-foreground">Tools used:</span> {(output.toolsUsed as string[]).join(", ")}</p>
                                            )}
                                            {/* Response preview (for non-thread outputs) */}
                                            {output.response && !output.threadId && !output.primaryThreadId && (
                                              <div className="mt-1">
                                                <p className="text-muted-foreground mb-1">Response:</p>
                                                <pre className="whitespace-pre-wrap break-words rounded border border-white/[0.08] bg-muted/30 p-2 max-h-60 overflow-y-auto">{String(output.response)}</pre>
                                              </div>
                                            )}
                                            {/* Error */}
                                            {output.error && (
                                              <p className="text-red-400"><span className="text-muted-foreground">Error:</span> {String(output.error)}</p>
                                            )}
                                          </div>
                                        </Collapse>
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              );
                            })}
                            {runDetail.task_runs.length === 0 && (
                              <tr><td className="px-2 py-3 text-muted-foreground" colSpan={5}>No task-runs recorded.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {consoleMessage && (
            <p className={`text-xs ${consoleMessage.includes("Failed") ? "text-red-400" : "text-green-400"}`}>
              {consoleMessage}
            </p>
          )}

          {!focusedView && selectedScheduleDetail?.schedule && (
            <div className="rounded-lg border border-white/[0.08] p-3">
              <p className="text-xs text-muted-foreground">Click <strong>Full Details</strong> on the selected header task to inspect full runs and  log links.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
