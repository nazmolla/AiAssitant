"use client";

import { Fragment, useEffect, useState } from "react";
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

interface SchedulerTaskRecord {
  id: string;
  task_key: string;
  name: string;
  handler_name: string;
  execution_mode: string;
  sequence_no: number;
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

export function SchedulerConfig() {
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
    execution_mode: "sync" | "async" | "fanout";
    sequence_no: number;
    enabled: number;
  }>>([]);

  const toggleScheduleSelection = (id: string) => {
    setSelectedScheduleIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const clearScheduleSelection = () => setSelectedScheduleIds([]);

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

      if (!selectedScheduleId && nextSchedules.length > 0) {
        setSelectedScheduleId(nextSchedules[0].id);
      }
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
    setDetailName(selectedScheduleDetail.schedule.name);
    setDetailTriggerType(selectedScheduleDetail.schedule.trigger_type as "cron" | "interval" | "once");
    setDetailTriggerExpr(selectedScheduleDetail.schedule.trigger_expr);
    setDetailTasks(
      selectedScheduleDetail.tasks.map((t) => ({
        id: t.id,
        task_key: t.task_key,
        name: t.name,
        handler_name: t.handler_name,
        execution_mode: (t.execution_mode as "sync" | "async" | "fanout") || "sync",
        sequence_no: t.sequence_no,
        enabled: t.enabled,
      }))
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
      const scheduleRes = await fetch(`/api/scheduler/schedules/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: detailName.trim(),
          trigger_type: detailTriggerType,
          trigger_expr: detailTriggerExpr.trim(),
        }),
      });
      const scheduleJson = await scheduleRes.json().catch(() => ({}));
      if (!scheduleRes.ok) {
        setConsoleMessage((scheduleJson as { error?: string }).error || "Failed to update schedule.");
        return;
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

  const openBatchModalByKey = async (batchType: "proactive" | "knowledge" | "cleanup") => {
    const match = schedules.find((s) => {
      const blob = `${s.schedule_key} ${s.name}`.toLowerCase();
      if (batchType === "proactive") return blob.includes("proactive") || blob.includes("observer");
      if (batchType === "knowledge") return blob.includes("knowledge") && blob.includes("maintenance");
      return blob.includes("cleanup") || blob.includes("maintenance") || blob.includes("db");
    });

    if (!match) {
      setConsoleMessage("No matching batch schedule found. Create or refresh schedules first.");
      return;
    }

    setSelectedScheduleId(match.id);
    setFocusedView(false);
    setSelectedRunId(null);
    setRunDetail(null);
    await loadScheduleDetail(match.id);

    const fresh = await fetch(`/api/scheduler/schedules/${match.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null) as SchedulerScheduleDetailResponse | null;

    if (!fresh?.schedule) {
      setConsoleMessage("Failed to open batch configuration modal.");
      return;
    }

    setSelectedScheduleDetail(fresh);
    setDetailName(fresh.schedule.name);
    setDetailTriggerType(fresh.schedule.trigger_type as "cron" | "interval" | "once");
    setDetailTriggerExpr(fresh.schedule.trigger_expr);
    setDetailTasks(
      fresh.tasks.map((t) => ({
        id: t.id,
        task_key: t.task_key,
        name: t.name,
        handler_name: t.handler_name,
        execution_mode: (t.execution_mode as "sync" | "async" | "fanout") || "sync",
        sequence_no: t.sequence_no,
        enabled: t.enabled,
      }))
    );
    setFocusedView(true);
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
    const timer = window.setInterval(() => {
      loadConsole();
    }, 30000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-once polling interval; adding loadConsole would reset timer on every render
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
                    <th className="w-[5%] px-2 py-2 text-left">Sel</th>
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
              <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 sm:p-8">
                <div className="max-h-[95vh] w-full max-w-6xl overflow-y-auto rounded-xl border border-primary/30 bg-background p-4 sm:p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-primary">Focused Header View: {selectedScheduleDetail.schedule.name}</h3>
                    <div className="flex w-full flex-wrap gap-1 sm:w-auto">
                      <Button className="w-full sm:w-auto" variant="outline" size="sm" onClick={() => setFocusedView(false)}>Close</Button>
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
                        onChange={(e) => setDetailTriggerType(e.target.value as "cron" | "interval" | "once")}
                      >
                        <option value="interval">interval</option>
                        <option value="cron">cron</option>
                        <option value="once">once</option>
                      </select>
                      <input
                        className="rounded border border-white/[0.08] bg-background px-2 py-1 text-xs"
                        value={detailTriggerExpr}
                        onChange={(e) => setDetailTriggerExpr(e.target.value)}
                        placeholder="Trigger expression"
                      />
                    </div>

                    <div className="mt-3 overflow-x-auto rounded border border-white/[0.08]">
                      <table className="w-full text-xs">
                        <thead className="bg-muted/30">
                          <tr>
                            <th className="px-2 py-2 text-left">#</th>
                            <th className="px-2 py-2 text-left">Task Key</th>
                            <th className="px-2 py-2 text-left">Task Name</th>
                            <th className="px-2 py-2 text-left">Handler</th>
                            <th className="px-2 py-2 text-left">Mode</th>
                            <th className="px-2 py-2 text-left">Enabled</th>
                            <th className="px-2 py-2 text-left">Remove</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailTasks.map((task, idx) => (
                            <tr key={task.id || `${task.task_key}-${idx}`} className="border-t border-white/[0.06]">
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
                                <input
                                  className="w-full rounded border border-white/[0.08] bg-background px-1 py-1"
                                  value={task.handler_name}
                                  onChange={(e) => {
                                    const next = [...detailTasks];
                                    next[idx] = { ...next[idx], handler_name: e.target.value };
                                    setDetailTasks(next);
                                  }}
                                />
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
                                <td className="px-2 py-2">
                                  {taskRun.log_ref ? (
                                    <a className="text-primary underline" href="/api/logs?limit=200&source=scheduler-engine" target="_blank" rel="noreferrer">
                                      Open Logs ({taskRun.log_ref})
                                    </a>
                                  ) : (
                                    <span className="text-muted-foreground">-</span>
                                  )}
                                </td>
                              </tr>
                            ))}
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
              <p className="text-xs text-muted-foreground">Click <strong>Focus View</strong> on the selected header task to inspect full runs and log links.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display">Batch Scheduling</CardTitle>
          <CardDescription className="text-muted-foreground/60">
            Open recurrence modal configuration for proactive observer, knowledge maintenance, and cleanup flows.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground/70">Use links below to open the recurrence modal and define frequency/recurrence/subtasks.</p>
            <div className="flex flex-wrap gap-3">
              <button className="text-primary underline" onClick={() => openBatchModalByKey("proactive")}>Configure Proactive Scheduler</button>
              <button className="text-primary underline" onClick={() => openBatchModalByKey("knowledge")}>Configure Knowledge Maintenance</button>
              <button className="text-primary underline" onClick={() => openBatchModalByKey("cleanup")}>Configure Log Cleanup / Maintenance</button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
