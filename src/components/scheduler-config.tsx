"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import Collapse from "@mui/material/Collapse";

type BatchJobType = "proactive" | "knowledge" | "cleanup" | "email";

interface BatchJobParam {
  key: string;
  label: string;
  description?: string;
}

const batchParameterDefs: Record<BatchJobType, BatchJobParam[]> = {
  proactive: [
    { key: "proactive_interval", label: "Interval", description: "Recurrence interval (e.g., 10 minute)" },
    { key: "calendar_sources", label: "Calendar Sources", description: "CSV list of calendar identifiers to scan" },
  ],
  knowledge: [
    { key: "knowledge_scan_interval", label: "Scan Interval", description: "How often to scan for new documents" },
    { key: "max_knowledge_docs_per_run", label: "Max Docs/Run", description: "Limit documents processed per run" },
  ],
  cleanup: [
    { key: "cleanup_older_than_days", label: "Older Than (days)", description: "Delete logs older than N days" },
    { key: "cleanup_retention_policy", label: "Retention Policy", description: "Retention policy identifier" },
  ],
  email: [
    { key: "email_accounts", label: "Email Accounts", description: "CSV list of email accounts to read from" },
    { key: "email_sync_interval", label: "Sync Interval", description: "How often to poll email" },
  ],
};

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

export function SchedulerConfig() {
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [batchModalType, setBatchModalType] = useState<BatchJobType>("proactive");
  const [batchParameters, setBatchParameters] = useState<Record<string, string>>({});
  const [tabExpanded, setTabExpanded] = useState({ parameters: true, recurrence: true, subtasks: false });
  const [detailName, setDetailName] = useState("New Batch Job");
  const [detailTriggerType, setDetailTriggerType] = useState<"cron" | "interval" | "once">("interval");
  const [detailTriggerExpr, setDetailTriggerExpr] = useState("every:10:minute");
  const [detailTasks, setDetailTasks] = useState<Array<{
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
  const [savingDetail, setSavingDetail] = useState(false);
  const [consoleMessage, setConsoleMessage] = useState<string | null>(null);

  const openBatchCreateModal = (type: BatchJobType) => {
    setBatchModalType(type);
    setBatchParameters({});
    setDetailName(`New ${type} Scheduler`);
    setDetailTriggerType("interval");
    setDetailTriggerExpr("every:10:minute");
    setDetailTasks([]);
    setTabExpanded({ parameters: true, recurrence: true, subtasks: false });
    setBatchModalOpen(true);
  };

  const saveBatchModal = async () => {
    setSavingDetail(true);
    setConsoleMessage(null);
    try {
      const normalizedTriggerExpr = detailTriggerType === "interval"
        ? normalizeIntervalExprInput(detailTriggerExpr)
        : detailTriggerExpr.trim();

      const res = await fetch("/api/scheduler/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: detailName.trim(),
          trigger_type: detailTriggerType,
          trigger_expr: normalizedTriggerExpr,
          batch_job_type: batchModalType,
          batch_parameters: batchParameters,
          tasks: detailTasks.map((t, index) => ({
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

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setConsoleMessage((json as { error?: string }).error || "Failed to create batch scheduler.");
        return;
      }

      setConsoleMessage("Batch scheduler created successfully!");
      setBatchModalOpen(false);
      setBatchParameters({});
      setDetailTasks([]);
    } catch {
      setConsoleMessage("Failed to save batch scheduler.");
    } finally {
      setSavingDetail(false);
    }
  };

  return (
    <div className="w-full space-y-4" data-testid="scheduler-config">
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display">Batch Scheduling</CardTitle>
          <CardDescription className="text-muted-foreground/60">
            Configure recurrence model configuration for proactive observer, knowledge maintenance, cleanup, and email reading flows.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground/70">Use links below to open the recurrence modal and define frequency/recurrence/subtasks.</p>
            <div className="flex flex-wrap gap-3">
              <button className="text-primary underline" onClick={() => openBatchCreateModal("proactive")}>New Proactive Scheduler</button>
              <button className="text-primary underline" onClick={() => openBatchCreateModal("knowledge")}>New Knowledge Maintenance</button>
              <button className="text-primary underline" onClick={() => openBatchCreateModal("cleanup")}>New Log Cleanup / Maintenance</button>
              <button className="text-primary underline" onClick={() => openBatchCreateModal("email")}>New Email Reading Batch</button>
            </div>
          </div>

          {consoleMessage && (
            <p className={`text-xs ${consoleMessage.includes("Failed") ? "text-red-400" : "text-green-400"}`}>
              {consoleMessage}
            </p>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={batchModalOpen}
        onClose={() => setBatchModalOpen(false)}
        fullWidth
        maxWidth="lg"
      >
        <DialogTitle>
          <div className="flex items-center justify-between gap-2">
            <span>Batch Scheduler - {batchModalType}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setBatchModalOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={saveBatchModal} disabled={savingDetail}>OK</Button>
            </div>
          </div>
        </DialogTitle>
        <DialogContent dividers>
          <div className="space-y-3">
            <button
              className="w-full rounded border border-white/[0.08] px-3 py-2 text-left text-sm"
              onClick={() => setTabExpanded((prev) => ({ ...prev, parameters: !prev.parameters }))}
            >
              Parameters
            </button>
            <Collapse in={tabExpanded.parameters}>
              <div className="rounded border border-white/[0.08] p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  {(batchParameterDefs[batchModalType] || []).map((param) => (
                    <div key={param.key} className="space-y-1">
                      <label className="text-xs text-muted-foreground">{param.label}</label>
                      <input
                        className="w-full rounded border border-white/[0.08] bg-background px-2 py-1 text-xs"
                        value={batchParameters[param.key] ?? ""}
                        onChange={(e) => setBatchParameters((prev) => ({ ...prev, [param.key]: e.target.value }))}
                        placeholder={param.description}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </Collapse>

            <button
              className="w-full rounded border border-white/[0.08] px-3 py-2 text-left text-sm"
              onClick={() => setTabExpanded((prev) => ({ ...prev, recurrence: !prev.recurrence }))}
            >
              Recurrence
            </button>
            <Collapse in={tabExpanded.recurrence}>
              <div className="rounded border border-white/[0.08] p-3">
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
              </div>
            </Collapse>

            <button
              className="w-full rounded border border-white/[0.08] px-3 py-2 text-left text-sm"
              onClick={() => setTabExpanded((prev) => ({ ...prev, subtasks: !prev.subtasks }))}
            >
              Subtasks
            </button>
            <Collapse in={tabExpanded.subtasks}>
              <div className="rounded border border-white/[0.08] p-3 space-y-2">
                <div className="overflow-x-auto rounded border border-white/[0.08]">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/30">
                      <tr>
                        <th className="px-2 py-2 text-left">#</th>
                        <th className="px-2 py-2 text-left">Task Key</th>
                        <th className="px-2 py-2 text-left">Name</th>
                        <th className="px-2 py-2 text-left">Handler</th>
                        <th className="px-2 py-2 text-left">Mode</th>
                        <th className="px-2 py-2 text-left">Remove</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailTasks.map((task, idx) => (
                        <tr key={`${task.task_key}-${idx}`} className="border-t border-white/[0.06]">
                          <td className="px-2 py-2">
                            <input
                              className="w-8 rounded border border-white/[0.08] bg-background px-1 py-1"
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
                      {detailTasks.length === 0 && (
                        <tr>
                          <td className="px-2 py-3 text-muted-foreground" colSpan={6}>No subtasks added.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <Button
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
              </div>
            </Collapse>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
