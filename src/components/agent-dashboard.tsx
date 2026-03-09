"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import FormControlLabel from "@mui/material/FormControlLabel";
import MuiSwitch from "@mui/material/Switch";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import TextField from "@mui/material/TextField";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { useTheme } from "@/components/theme-provider";
import { useIsMobile } from "@/hooks/use-is-mobile";

interface LogEntry {
  id: number;
  level: "verbose" | "warning" | "error" | "critical";
  source: string | null;
  message: string;
  metadata: string | null;
  created_at: string;
}

type LogFilter = "all" | "verbose" | "warning" | "error" | "critical" | "thought";
type ChartMetric = "activities" | "errors";
type DashboardView = "graphs" | "details";

interface TimeBucket {
  start: number;
  end: number;
  label: string;
  activities: number;
  errors: number;
  sessions: number;
}

interface SessionRecord {
  id: string;
  logs: LogEntry[];
  outcome: "resolved" | "escalated" | "abandoned" | "open";
  engaged: boolean;
  topic: string;
  lastTs: number;
}

interface DriverRow {
  topic: string;
  rate: number;
  impact: number;
}

// Pure helper functions — module-level to avoid re-creation per render
function levelColor(level: string): "error" | "warning" | "default" | "info" | "primary" {
  switch (level) {
    case "critical": return "error";
    case "error": return "error";
    case "warning": return "warning";
    case "verbose": return "default";
    default: return "info";
  }
}

function sourceColor(source: string | null) {
  switch (source) {
    case "agent": return "text-blue-400";
    case "scheduler": return "text-purple-400";
    case "mcp": return "text-green-400";
    case "hitl": return "text-yellow-400";
    default: return "text-muted-foreground";
  }
}

/** Safely parse metadata JSON into a key-value record for display. */
function parseMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    return { value: parsed };
  } catch {
    return { raw };
  }
}

/** Render a single metadata value as readable text. */
function formatMetaValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  return JSON.stringify(value, null, 2);
}

function extractSessionKey(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    const candidateKeys = ["sessionId", "session_id", "threadId", "thread_id", "conversationId", "conversation_id", "chatId", "chat_id", "run_id"];
    for (const key of candidateKeys) {
      const val = obj[key];
      if (typeof val === "string" && val.trim()) return val;
      if (typeof val === "number") return String(val);
    }
    return null;
  } catch {
    return null;
  }
}

function inferOutcome(logs: LogEntry[]): "resolved" | "escalated" | "abandoned" | "open" {
  const text = logs.map((log) => `${log.message} ${log.metadata ?? ""}`.toLowerCase()).join(" ");
  if (/abandon|cancel|timeout|dropped|terminated/.test(text)) return "abandoned";
  if (/escalat|failed|fatal|critical|denied|exception/.test(text)) return "escalated";
  if (/resolved|completed|success|approved|done/.test(text)) return "resolved";
  return "open";
}

function inferTopic(logs: LogEntry[]): string {
  const text = logs.map((log) => `${log.message} ${log.metadata ?? ""}`.toLowerCase()).join(" ");
  if (/payment|billing|invoice|refund/.test(text)) return "Payment";
  if (/device|alexa|smarthome|light|volume/.test(text)) return "Device";
  if (/network|connection|socket|dns|latency/.test(text)) return "Connectivity";
  if (/auth|token|login|credential|permission/.test(text)) return "Authentication";
  if (/mcp|tool|plugin/.test(text)) return "Tooling";
  return "General";
}

function toPct(value: number): string {
  return `${Math.round(value)}%`;
}

export function AgentDashboard() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [dashboardView, setDashboardView] = useState<DashboardView>("graphs");
  const [searchQuery, setSearchQuery] = useState("");
  const [renderCount, setRenderCount] = useState(400);
  const [filter, setFilter] = useState<LogFilter>("all");
  const [chartMetric, setChartMetric] = useState<ChartMetric>("activities");
  const [drilldownStart, setDrilldownStart] = useState<number | null>(null);
  const [sessionDrilldownStart, setSessionDrilldownStart] = useState<number | null>(null);
  const [startDate, setStartDate] = useState<string>(() => {
    const now = new Date();
    const prior = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
    return prior.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);
  const { formatDate } = useTheme();

  const fetchLogs = useCallback(() => {
    fetch("/api/logs?limit=all&level=all&source=all")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setLogs(d); })
      .catch(console.error);
  }, []);

  useEffect(() => {
    setRenderCount(showAllLogs ? 400 : 200);
  }, [showAllLogs, searchQuery]);

  useEffect(() => {
    fetchLogs();
    const shouldAutoRefresh = autoRefresh && !showAllLogs;
    if (shouldAutoRefresh) {
      const interval = setInterval(fetchLogs, 15000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, showAllLogs, fetchLogs]);

  const rangeStartMs = useMemo(() => {
    const ts = new Date(`${startDate}T00:00:00`).getTime();
    return Number.isNaN(ts) ? Date.now() - 7 * 24 * 60 * 60 * 1000 : ts;
  }, [startDate]);

  const rangeEndMs = useMemo(() => {
    const ts = new Date(`${endDate}T23:59:59.999`).getTime();
    return Number.isNaN(ts) ? Date.now() : ts;
  }, [endDate]);

  const logsInRange = useMemo(() => logs.filter((l) => {
    const ts = new Date(l.created_at).getTime();
    if (Number.isNaN(ts)) return false;
    return ts >= rangeStartMs && ts <= rangeEndMs;
  }), [logs, rangeStartMs, rangeEndMs]);

  const filteredLogs = useMemo(() => logsInRange.filter((l) => {
    if (filter === "all") return true;
    if (filter === "thought") return l.source === "thought";
    if (filter === "verbose") return l.level === "verbose";
    if (filter === "warning") return l.level === "warning";
    if (filter === "error") return l.level === "error";
    if (filter === "critical") return l.level === "critical";
    return true;
  }), [logsInRange, filter]);

  const sessionAnalytics = useMemo(() => {
    const sessionsMap = new Map<string, LogEntry[]>();
    for (const log of logsInRange) {
      const sessionId = extractSessionKey(log.metadata);
      // Only group logs that have an actual session identifier — logs without
      // session metadata are standalone events, not sessions.
      if (!sessionId) continue;
      const existing = sessionsMap.get(sessionId);
      if (existing) existing.push(log);
      else sessionsMap.set(sessionId, [log]);
    }

    const sessions: SessionRecord[] = Array.from(sessionsMap.entries()).map(([id, sessionLogs]) => {
      const outcome = inferOutcome(sessionLogs);
      const engaged = sessionLogs.length >= 3 || sessionLogs.some((l) => l.source === "agent" || l.source === "thought");
      const topic = inferTopic(sessionLogs);
      const lastTs = Math.max(...sessionLogs.map((l) => new Date(l.created_at).getTime()));
      return { id, logs: sessionLogs, outcome, engaged, topic, lastTs };
    });

    const total = sessions.length;
    const resolved = sessions.filter((s) => s.outcome === "resolved").length;
    const escalated = sessions.filter((s) => s.outcome === "escalated").length;
    const abandoned = sessions.filter((s) => s.outcome === "abandoned").length;
    const engaged = sessions.filter((s) => s.engaged).length;

    return {
      sessions,
      total,
      resolved,
      escalated,
      abandoned,
      engaged,
      engagementRate: total ? (engaged / total) * 100 : 0,
      resolutionRate: total ? (resolved / total) * 100 : 0,
      escalationRate: total ? (escalated / total) * 100 : 0,
      abandonRate: total ? (abandoned / total) * 100 : 0,
      csat: Math.max(1, Math.min(5, 4 + ((resolved - escalated - abandoned) / Math.max(total, 1)))),
    };
  }, [logsInRange]);

  const chartBuckets = useMemo<TimeBucket[]>(() => {
    const bucketCount = 8;
    const rangeSpan = Math.max(rangeEndMs - rangeStartMs + 1, 8 * 60 * 60 * 1000);
    const bucketMs = Math.max(60 * 60 * 1000, Math.ceil(rangeSpan / bucketCount));
    const start = rangeStartMs;
    const sessionSets: Set<string>[] = Array.from({ length: bucketCount }, () => new Set<string>());

    const buckets: TimeBucket[] = Array.from({ length: bucketCount }, (_, idx) => {
      const bucketStart = start + idx * bucketMs;
      return {
        start: bucketStart,
        end: bucketStart + bucketMs,
        label: formatDate(new Date(bucketStart).toISOString(), { month: "2-digit", day: "2-digit", hour: "2-digit" }),
        activities: 0,
        errors: 0,
        sessions: 0,
      };
    });

    for (const log of logsInRange) {
      const ts = new Date(log.created_at).getTime();
      if (Number.isNaN(ts) || ts < start || ts > rangeEndMs) continue;
      const index = Math.floor((ts - start) / bucketMs);
      const bucket = buckets[index];
      if (!bucket) continue;
      bucket.activities += 1;
      if (log.level === "error" || log.level === "critical") bucket.errors += 1;
      const sessionKey = extractSessionKey(log.metadata);
      if (sessionKey) sessionSets[index].add(sessionKey);
    }

    for (let i = 0; i < buckets.length; i += 1) {
      buckets[i].sessions = sessionSets[i].size;
    }

    return buckets;
  }, [logsInRange, formatDate, rangeStartMs, rangeEndMs]);

  const outcomesByBucket = useMemo(() => {
    const rows = chartBuckets.map((bucket) => ({ start: bucket.start, label: bucket.label, resolved: 0, escalated: 0, abandoned: 0 }));
    if (rows.length === 0) return rows;
    const bucketMs = chartBuckets[0].end - chartBuckets[0].start;
    for (const session of sessionAnalytics.sessions) {
      if (Number.isNaN(session.lastTs) || session.lastTs < chartBuckets[0].start) continue;
      const idx = Math.floor((session.lastTs - chartBuckets[0].start) / bucketMs);
      const row = rows[idx];
      if (!row) continue;
      if (session.outcome === "resolved") row.resolved += 1;
      if (session.outcome === "escalated") row.escalated += 1;
      if (session.outcome === "abandoned") row.abandoned += 1;
    }
    return rows;
  }, [chartBuckets, sessionAnalytics.sessions]);

  const driverRows = useMemo(() => {
    const makeRows = (outcome: SessionRecord["outcome"]): DriverRow[] => {
      const totalsByTopic = new Map<string, number>();
      const outcomeByTopic = new Map<string, number>();
      for (const s of sessionAnalytics.sessions) {
        totalsByTopic.set(s.topic, (totalsByTopic.get(s.topic) ?? 0) + 1);
        if (s.outcome === outcome) outcomeByTopic.set(s.topic, (outcomeByTopic.get(s.topic) ?? 0) + 1);
      }

      const overallRate = sessionAnalytics.total ? (sessionAnalytics.sessions.filter((s) => s.outcome === outcome).length / sessionAnalytics.total) * 100 : 0;
      return Array.from(totalsByTopic.entries())
        .map(([topic, total]) => {
          const matched = outcomeByTopic.get(topic) ?? 0;
          const rate = total ? (matched / total) * 100 : 0;
          return { topic, rate, impact: rate - overallRate };
        })
        .sort((a, b) => b.rate - a.rate)
        .slice(0, 4);
    };

    return {
      resolved: makeRows("resolved"),
      escalated: makeRows("escalated"),
      abandoned: makeRows("abandoned"),
    };
  }, [sessionAnalytics]);

  const drilldownLogs = useMemo(() => {
    if (sessionDrilldownStart !== null) {
      const selectedSessionBucket = chartBuckets.find((b) => b.start === sessionDrilldownStart);
      if (!selectedSessionBucket) return filteredLogs;
      return filteredLogs.filter((log) => {
        const ts = new Date(log.created_at).getTime();
        if (Number.isNaN(ts) || ts < selectedSessionBucket.start || ts >= selectedSessionBucket.end) return false;
        return extractSessionKey(log.metadata) !== null;
      });
    }

    if (drilldownStart === null) return filteredLogs;
    const selectedBucket = chartBuckets.find((b) => b.start === drilldownStart);
    if (!selectedBucket) return filteredLogs;

    return filteredLogs.filter((log) => {
      const ts = new Date(log.created_at).getTime();
      if (Number.isNaN(ts) || ts < selectedBucket.start || ts >= selectedBucket.end) return false;
      if (chartMetric === "errors") return log.level === "error" || log.level === "critical";
      return true;
    });
  }, [filteredLogs, drilldownStart, sessionDrilldownStart, chartBuckets, chartMetric]);

  // Memoize stat counts to avoid re-computing on every render
  const stats = useMemo(() => {
    let verbose = 0;
    let warnings = 0;
    let errors = 0;
    let critical = 0;
    let thoughts = 0;
    for (const log of logsInRange) {
      if (log.level === "verbose") verbose += 1;
      if (log.level === "warning") warnings += 1;
      if (log.level === "error") errors += 1;
      if (log.level === "critical") critical += 1;
      if (log.source === "thought") thoughts += 1;
    }
    return {
      total: logsInRange.length,
      verbose,
      warnings,
      errors,
      critical,
      thoughts,
    };
  }, [logsInRange]);

  const searchedLogs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return drilldownLogs;
    return drilldownLogs.filter((log) => {
      const haystack = `${log.message} ${log.level} ${log.source ?? ""} ${log.metadata ?? ""}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [drilldownLogs, searchQuery]);

  const visibleLogs = useMemo(() => searchedLogs.slice(0, renderCount), [searchedLogs, renderCount]);
  const isMobile = useIsMobile();
  const chartMax = useMemo(() => {
    const maxVal = chartBuckets.reduce((acc, b) => Math.max(acc, b.activities, b.errors), 0);
    return maxVal > 0 ? maxVal : 1;
  }, [chartBuckets]);
  const sessionsMax = useMemo(() => {
    const maxVal = chartBuckets.reduce((acc, b) => Math.max(acc, b.sessions), 0);
    return maxVal > 0 ? maxVal : 1;
  }, [chartBuckets]);
  const selectedBucket = useMemo(() => chartBuckets.find((b) => b.start === drilldownStart) ?? null, [chartBuckets, drilldownStart]);
  const selectedSessionBucket = useMemo(() => chartBuckets.find((b) => b.start === sessionDrilldownStart) ?? null, [chartBuckets, sessionDrilldownStart]);

  useEffect(() => {
    setDrilldownStart(null);
    setSessionDrilldownStart(null);
  }, [startDate, endDate]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box sx={{ display: "flex", flexDirection: { xs: "column", sm: "row" }, alignItems: { sm: "center" }, justifyContent: "space-between", gap: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>Agent Dashboard</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Real-time activity and diagnostics</Typography>
        </Box>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }}>
          <TextField
            type="date"
            size="small"
            label="Start"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            type="date"
            size="small"
            label="End"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <FormControlLabel
            control={<MuiSwitch size="small" checked={showAllLogs} onChange={() => setShowAllLogs(!showAllLogs)} />}
            label={<Typography variant="caption">Show all logs</Typography>}
          />
          <FormControlLabel
            control={<MuiSwitch size="small" checked={autoRefresh} onChange={() => setAutoRefresh(!autoRefresh)} />}
            label={<Typography variant="caption">Auto-refresh</Typography>}
          />
        </Box>
      </Box>

      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column", sm: "row" },
          alignItems: { sm: "center" },
          justifyContent: "space-between",
          gap: 1,
          border: 1,
          borderColor: "divider",
          borderRadius: 2,
          p: 1.25,
          bgcolor: "background.paper",
        }}
      >
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: 0.6 }}>
          Dashboard View
        </Typography>
        <ToggleButtonGroup
          value={dashboardView}
          exclusive
          size="small"
          fullWidth={isMobile}
          onChange={(_, val: DashboardView | null) => {
            if (!val) return;
            setDashboardView(val);
          }}
        >
          <ToggleButton value="graphs">Graphs</ToggleButton>
          <ToggleButton value="details">Details</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {dashboardView === "graphs" && (
        <>
      {/* KPI Cards */}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(3, 1fr)", lg: "repeat(6, 1fr)" }, gap: { xs: 1.5, sm: 2 } }}>
        {([
          { label: "Sessions", value: sessionAnalytics.total, color: "primary.main" },
          { label: "Engagement", value: toPct(sessionAnalytics.engagementRate), color: "info.main" },
          { label: "Resolution", value: toPct(sessionAnalytics.resolutionRate), color: "success.main" },
          { label: "Escalation", value: toPct(sessionAnalytics.escalationRate), color: "warning.main" },
          { label: "Abandon", value: toPct(sessionAnalytics.abandonRate), color: "error.main" },
          { label: "CSAT", value: sessionAnalytics.csat.toFixed(1), color: "secondary.main" },
        ] as const).map((metric) => (
          <Card key={metric.label} variant="outlined">
            <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
              <Typography variant="overline" color="text.secondary" sx={{ fontSize: "0.65rem" }}>{metric.label}</Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, color: metric.color }}>{metric.value}</Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      {/* Summary Cards — clickable to filter logs */}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(3, 1fr)", lg: "repeat(6, 1fr)" }, gap: { xs: 1.5, sm: 2 } }}>
        {([
          { key: "all" as LogFilter, label: "Total Logs", value: stats.total, color: "primary.main" },
          { key: "verbose" as LogFilter, label: "Verbose", value: stats.verbose, color: "info.main" },
          { key: "warning" as LogFilter, label: "Warnings", value: stats.warnings, color: "warning.main" },
          { key: "error" as LogFilter, label: "Errors", value: stats.errors, color: "error.main" },
          { key: "critical" as LogFilter, label: "Critical", value: stats.critical, color: "error.dark" },
          { key: "thought" as LogFilter, label: "Thoughts", value: stats.thoughts, color: "secondary.main" },
        ] as const).map((stat) => (
          <Card
            key={stat.key}
            variant="outlined"
            sx={{
              cursor: "pointer",
              transition: "all 0.2s",
              borderColor: filter === stat.key ? `${stat.color}` : "divider",
              bgcolor: filter === stat.key ? `action.selected` : undefined,
              "&:hover": { borderColor: stat.color },
            }}
            onClick={() => setFilter(stat.key === filter && stat.key !== "all" ? "all" : stat.key)}
          >
            <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
              <Typography variant="overline" color="text.secondary" sx={{ fontSize: "0.65rem" }}>{stat.label}</Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, color: stat.color }}>{stat.value}</Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      {/* Errors vs Activities Chart with drilldown */}
      <Card variant="outlined">
        <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider", display: "flex", flexDirection: { xs: "column", sm: "row" }, gap: 1.5, alignItems: { sm: "center" }, justifyContent: "space-between" }}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Errors & Activities (Last 24h)</Typography>
            <Typography variant="caption" color="text.secondary">Click any time bucket to drill down into detailed logs.</Typography>
          </Box>
          <ToggleButtonGroup
            value={chartMetric}
            exclusive
            size="small"
            onChange={(_, val: ChartMetric | null) => {
              if (!val) return;
              setChartMetric(val);
            }}
          >
            <ToggleButton value="activities">Activities</ToggleButton>
            <ToggleButton value="errors">Errors</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        <CardContent sx={{ pt: 2 }}>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(8, minmax(0, 1fr))", gap: 1, alignItems: "end" }}>
            {chartBuckets.map((bucket) => {
              const isSelected = drilldownStart === bucket.start;
              const mainValue = chartMetric === "activities" ? bucket.activities : bucket.errors;
              const activitiesHeight = (bucket.activities / chartMax) * 100;
              const errorsHeight = (bucket.errors / chartMax) * 100;
              return (
                <Box
                  key={bucket.start}
                  onClick={() => {
                    setSessionDrilldownStart(null);
                    setDrilldownStart(isSelected ? null : bucket.start);
                  }}
                  sx={{
                    borderRadius: 1.5,
                    p: 1,
                    border: 1,
                    borderColor: isSelected ? "primary.main" : "divider",
                    cursor: "pointer",
                    bgcolor: isSelected ? "action.selected" : "transparent",
                    transition: "all 0.15s ease",
                    "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" },
                  }}
                >
                  <Typography variant="caption" sx={{ display: "block", textAlign: "center", fontWeight: 700 }}>
                    {mainValue}
                  </Typography>
                  <Box sx={{ position: "relative", height: 120, mt: 0.75 }}>
                    <Box
                      sx={{
                        position: "absolute",
                        bottom: 0,
                        left: "22%",
                        width: "24%",
                        height: `${activitiesHeight}%`,
                        minHeight: bucket.activities > 0 ? 3 : 0,
                        bgcolor: "primary.main",
                        opacity: 0.55,
                        borderRadius: 0.75,
                      }}
                    />
                    <Box
                      sx={{
                        position: "absolute",
                        bottom: 0,
                        right: "22%",
                        width: "24%",
                        height: `${errorsHeight}%`,
                        minHeight: bucket.errors > 0 ? 3 : 0,
                        bgcolor: "error.main",
                        borderRadius: 0.75,
                      }}
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", textAlign: "center", mt: 0.5 }}>
                    {bucket.label}
                  </Typography>
                </Box>
              );
            })}
          </Box>
          <Box sx={{ mt: 1.5, display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: "primary.main", opacity: 0.55 }} />
              <Typography variant="caption" color="text.secondary">Activities</Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: "error.main" }} />
              <Typography variant="caption" color="text.secondary">Errors</Typography>
            </Box>
            {selectedBucket && (
              <Chip
                size="small"
                variant="outlined"
                label={`Drilldown: ${formatDate(new Date(selectedBucket.start).toISOString(), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} - ${formatDate(new Date(selectedBucket.end).toISOString(), { hour: "2-digit", minute: "2-digit" })}`}
                onDelete={() => setDrilldownStart(null)}
              />
            )}
          </Box>
        </CardContent>
      </Card>

      {/* Session Outcomes Trend */}
      <Card variant="outlined">
        <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Session Outcomes Over Time</Typography>
        </Box>
        <CardContent sx={{ pt: 2 }}>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(8, minmax(0, 1fr))", gap: 1, alignItems: "end" }}>
            {outcomesByBucket.map((row) => {
              const maxVal = Math.max(...outcomesByBucket.map((r) => r.resolved + r.escalated + r.abandoned), 1);
              const resolvedHeight = ((row.resolved / maxVal) * 100);
              const escalatedHeight = ((row.escalated / maxVal) * 100);
              const abandonedHeight = ((row.abandoned / maxVal) * 100);
              return (
                <Box key={`out-${row.start}`} sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, p: 1 }}>
                  <Typography variant="caption" sx={{ display: "block", textAlign: "center", fontWeight: 700 }}>{row.resolved + row.escalated + row.abandoned}</Typography>
                  <Box sx={{ position: "relative", height: 120, mt: 0.75 }}>
                    <Box sx={{ position: "absolute", bottom: 0, left: "18%", width: "18%", height: `${resolvedHeight}%`, minHeight: row.resolved ? 3 : 0, bgcolor: "success.main", borderRadius: 0.75 }} />
                    <Box sx={{ position: "absolute", bottom: 0, left: "41%", width: "18%", height: `${escalatedHeight}%`, minHeight: row.escalated ? 3 : 0, bgcolor: "warning.main", borderRadius: 0.75 }} />
                    <Box sx={{ position: "absolute", bottom: 0, left: "64%", width: "18%", height: `${abandonedHeight}%`, minHeight: row.abandoned ? 3 : 0, bgcolor: "error.main", borderRadius: 0.75 }} />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", textAlign: "center", mt: 0.5 }}>{row.label}</Typography>
                </Box>
              );
            })}
          </Box>
          <Box sx={{ mt: 1.5, display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}><Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: "success.main" }} /><Typography variant="caption" color="text.secondary">Resolved</Typography></Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}><Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: "warning.main" }} /><Typography variant="caption" color="text.secondary">Escalated</Typography></Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}><Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: "error.main" }} /><Typography variant="caption" color="text.secondary">Abandoned</Typography></Box>
          </Box>
        </CardContent>
      </Card>

      {/* Drivers tables */}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "repeat(3, 1fr)" }, gap: 2 }}>
        {([
          { title: "Resolution rate drivers", rows: driverRows.resolved },
          { title: "Escalation rate drivers", rows: driverRows.escalated },
          { title: "Abandon rate drivers", rows: driverRows.abandoned },
        ] as const).map((block) => (
          <Card key={block.title} variant="outlined">
            <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>{block.title}</Typography>
            </Box>
            <TableContainer>
              <Table size="small" aria-label={block.title}>
                <TableHead>
                  <TableRow>
                    <TableCell>Topic</TableCell>
                    <TableCell align="right">Rate</TableCell>
                    <TableCell align="right">Impact</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {block.rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} sx={{ color: "text.secondary" }}>No data</TableCell>
                    </TableRow>
                  )}
                  {block.rows.map((r) => (
                    <TableRow key={r.topic}>
                      <TableCell>{r.topic}</TableCell>
                      <TableCell align="right">{toPct(r.rate)}</TableCell>
                      <TableCell align="right" sx={{ color: r.impact >= 0 ? "success.main" : "error.main" }}>{`${r.impact >= 0 ? "+" : ""}${toPct(r.impact)}`}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        ))}
      </Box>

      {/* Sessions Chart with drilldown */}
      <Card variant="outlined">
        <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Sessions (Last 24h)</Typography>
          <Typography variant="caption" color="text.secondary">Unique sessions inferred from log metadata per time bucket. Click bucket to drill down.</Typography>
        </Box>
        <CardContent sx={{ pt: 2 }}>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(8, minmax(0, 1fr))", gap: 1, alignItems: "end" }}>
            {chartBuckets.map((bucket) => {
              const isSelected = sessionDrilldownStart === bucket.start;
              const sessionsHeight = (bucket.sessions / sessionsMax) * 100;
              return (
                <Box
                  key={`session-${bucket.start}`}
                  onClick={() => {
                    setDrilldownStart(null);
                    setSessionDrilldownStart(isSelected ? null : bucket.start);
                  }}
                  sx={{
                    borderRadius: 1.5,
                    p: 1,
                    border: 1,
                    borderColor: isSelected ? "secondary.main" : "divider",
                    cursor: "pointer",
                    bgcolor: isSelected ? "action.selected" : "transparent",
                    transition: "all 0.15s ease",
                    "&:hover": { borderColor: "secondary.main", bgcolor: "action.hover" },
                  }}
                >
                  <Typography variant="caption" sx={{ display: "block", textAlign: "center", fontWeight: 700 }}>
                    {bucket.sessions}
                  </Typography>
                  <Box sx={{ position: "relative", height: 120, mt: 0.75 }}>
                    <Box
                      sx={{
                        position: "absolute",
                        bottom: 0,
                        left: "35%",
                        width: "30%",
                        height: `${sessionsHeight}%`,
                        minHeight: bucket.sessions > 0 ? 3 : 0,
                        bgcolor: "secondary.main",
                        borderRadius: 0.75,
                      }}
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", textAlign: "center", mt: 0.5 }}>
                    {bucket.label}
                  </Typography>
                </Box>
              );
            })}
          </Box>
          {selectedSessionBucket && (
            <Box sx={{ mt: 1.5 }}>
              <Chip
                size="small"
                variant="outlined"
                label={`Session drilldown: ${formatDate(new Date(selectedSessionBucket.start).toISOString(), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} - ${formatDate(new Date(selectedSessionBucket.end).toISOString(), { hour: "2-digit", minute: "2-digit" })}`}
                onDelete={() => setSessionDrilldownStart(null)}
              />
            </Box>
          )}
        </CardContent>
      </Card>
        </>
      )}

      {dashboardView === "details" && (
        <>

      {/* Log Filters */}
      <Box sx={{ borderRadius: 2, border: 1, borderColor: "divider", p: 1.5 }}>
        <Typography variant="overline" color="text.secondary" sx={{ fontSize: "0.65rem", mb: 1, display: "block" }}>Log Filters</Typography>
        <Box sx={{ mb: 1.25 }}>
          <TextField
            fullWidth
            size="small"
            placeholder="Search logs, source, level, metadata..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </Box>
        <ToggleButtonGroup
          value={filter}
          exclusive
          onChange={(_, val) => { if (val !== null) setFilter(val); }}
          size="small"
          sx={{ flexWrap: "wrap", gap: 0.5 }}
        >
          {(["all", "verbose", "warning", "error", "critical", "thought"] as LogFilter[]).map((f) => (
            <ToggleButton key={f} value={f} sx={{ textTransform: "capitalize", px: 1.5, py: 0.5, fontSize: "0.75rem" }}>
              {f}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      {filter !== "all" && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="caption" color="text.secondary">Filtering:</Typography>
          <Chip label={`${filter} only`} size="small" variant="outlined" onDelete={() => setFilter("all")} />
        </Box>
      )}

      {searchQuery.trim() !== "" && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="caption" color="text.secondary">Search:</Typography>
          <Chip label={searchQuery} size="small" variant="outlined" onDelete={() => setSearchQuery("")} />
        </Box>
      )}

      {showAllLogs && autoRefresh && (
        <Typography variant="caption" color="text.secondary" sx={{ bgcolor: "action.hover", borderRadius: 1, px: 1.5, py: 1, display: "block" }}>
          Auto-refresh is paused in &quot;Show all logs&quot; mode to keep mobile performance smooth.
        </Typography>
      )}

      {/* Log Stream */}
      <Card variant="outlined">
        <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Agent Log Stream {showAllLogs ? "(All)" : "(Latest 200)"}
          </Typography>
          {(selectedBucket || selectedSessionBucket) && (
            <Typography variant="caption" color="text.secondary">
              {selectedSessionBucket
                ? "Showing session-associated details for selected chart bucket."
                : `Showing ${chartMetric === "errors" ? "error" : "activity"} details for selected chart bucket.`}
            </Typography>
          )}
        </Box>
        <CardContent>
          <Box sx={{ height: 500, overflow: "auto" }}>
            {isMobile ? (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {visibleLogs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  const meta = parseMetadata(log.metadata);
                  const hasDetails = meta !== null;
                  return (
                    <Box
                      key={log.id}
                      sx={{
                        borderRadius: 2,
                        border: 1,
                        borderColor: isExpanded ? "primary.main" : "divider",
                        p: 1.5,
                        display: "flex",
                        flexDirection: "column",
                        gap: 0.5,
                        cursor: hasDetails ? "pointer" : "default",
                        transition: "border-color 0.2s",
                        "&:hover": hasDetails ? { borderColor: "primary.light" } : {},
                      }}
                      onClick={() => hasDetails && setExpandedLogId(isExpanded ? null : log.id)}
                    >
                      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                        <Typography variant="caption" color="text.secondary">
                          {formatDate(log.created_at, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </Typography>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                          <Chip label={log.level} size="small" color={levelColor(log.level)} />
                          <Typography variant="caption" sx={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }} className={sourceColor(log.source)}>
                            {log.source || "sys"}
                          </Typography>
                          {hasDetails && (isExpanded ? <ExpandLessIcon sx={{ fontSize: 16, color: "text.secondary" }} /> : <ExpandMoreIcon sx={{ fontSize: 16, color: "text.secondary" }} />)}
                        </Box>
                      </Box>
                      <Typography variant="body2" sx={{ wordBreak: "break-word" }}>{log.message}</Typography>
                      <Collapse in={isExpanded} unmountOnExit>
                        <Box sx={{ mt: 1, p: 1.5, bgcolor: "action.hover", borderRadius: 1, borderLeft: 3, borderColor: "primary.main" }}>
                          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, mb: 0.5, display: "block" }}>Details</Typography>
                          {meta && Object.entries(meta).map(([key, val]) => (
                            <Box key={key} sx={{ display: "flex", gap: 1, mb: 0.5 }}>
                              <Typography variant="caption" sx={{ fontWeight: 600, minWidth: 80, color: "text.secondary", fontFamily: "monospace" }}>{key}:</Typography>
                              <Typography variant="caption" sx={{ wordBreak: "break-all", fontFamily: "monospace", whiteSpace: "pre-wrap" }}>{formatMetaValue(val)}</Typography>
                            </Box>
                          ))}
                        </Box>
                      </Collapse>
                    </Box>
                  );
                })}
              </Box>
            ) : (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
                {visibleLogs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  const meta = parseMetadata(log.metadata);
                  const hasDetails = meta !== null;
                  return (
                    <Box key={log.id}>
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 1.5,
                          p: 1,
                          borderRadius: 2,
                          fontFamily: "monospace",
                          fontSize: "0.875rem",
                          cursor: hasDetails ? "pointer" : "default",
                          bgcolor: isExpanded ? "action.selected" : "transparent",
                          "&:hover": { bgcolor: isExpanded ? "action.selected" : "action.hover" },
                        }}
                        onClick={() => hasDetails && setExpandedLogId(isExpanded ? null : log.id)}
                      >
                        <Typography variant="caption" color="text.disabled" sx={{ whiteSpace: "nowrap", fontFamily: "monospace" }}>
                          {formatDate(log.created_at, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </Typography>
                        <Chip label={log.level} size="small" color={levelColor(log.level)} />
                        <Typography variant="caption" sx={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }} className={sourceColor(log.source)}>
                          {log.source || "sys"}
                        </Typography>
                        <Typography variant="body2" sx={{ flex: 1, fontFamily: "monospace" }}>{log.message}</Typography>
                        {hasDetails && (
                          isExpanded
                            ? <ExpandLessIcon sx={{ fontSize: 18, color: "text.secondary", mt: 0.25 }} />
                            : <ExpandMoreIcon sx={{ fontSize: 18, color: "text.secondary", mt: 0.25 }} />
                        )}
                      </Box>
                      <Collapse in={isExpanded} unmountOnExit>
                        <Box sx={{ ml: 7, mr: 2, mb: 1, p: 1.5, bgcolor: "action.hover", borderRadius: 1, borderLeft: 3, borderColor: "primary.main" }}>
                          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, mb: 0.5, display: "block" }}>Details</Typography>
                          {meta && Object.entries(meta).map(([key, val]) => (
                            <Box key={key} sx={{ display: "flex", gap: 1.5, mb: 0.25 }}>
                              <Typography variant="caption" sx={{ fontWeight: 600, minWidth: 120, color: "text.secondary", fontFamily: "monospace" }}>{key}:</Typography>
                              <Typography variant="caption" sx={{ wordBreak: "break-all", fontFamily: "monospace", whiteSpace: "pre-wrap", flex: 1 }}>{formatMetaValue(val)}</Typography>
                            </Box>
                          ))}
                        </Box>
                      </Collapse>
                    </Box>
                  );
                })}
              </Box>
            )}

              {searchedLogs.length === 0 && (
                <Box sx={{ textAlign: "center", py: 6 }}>
                  <Typography variant="body2" color="text.secondary">
                    {selectedSessionBucket
                      ? "No session-associated logs found in this bucket."
                      : selectedBucket
                        ? `No ${chartMetric === "errors" ? "error" : "activity"} logs found in this bucket.`
                      : (filter !== "all" ? `No ${filter} logs found.` : searchQuery.trim() !== "" ? "No logs match your search." : "No agent logs yet. Start a conversation or enable proactive scanning.")}
                  </Typography>
                </Box>
              )}
              {searchedLogs.length > visibleLogs.length && (
                <Box sx={{ pt: 1, display: "flex", justifyContent: "center" }}>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => setRenderCount((prev) => prev + 400)}
                  >
                    Load more logs ({searchedLogs.length - visibleLogs.length} remaining)
                  </Button>
                </Box>
              )}
          </Box>
        </CardContent>
      </Card>
        </>
      )}
    </Box>
  );
}
