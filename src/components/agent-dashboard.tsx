"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import { useTheme } from "@/components/theme-provider";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import type { LogEntry, LogFilter, ChartMetric } from "@/lib/dashboard-analytics";
import { parseMetadata, formatMetaValue, toPct } from "@/lib/dashboard-analytics";

// ── Level badge ───────────────────────────────────────────────────────────────

const LEVEL_STYLES: Record<string, { fg: string; bg: string }> = {
  verbose:  { fg: "rgba(255,255,255,0.28)", bg: "rgba(255,255,255,0.05)" },
  info:     { fg: "#29b6f6",               bg: "rgba(41,182,246,0.10)"  },
  warning:  { fg: "#ffa726",               bg: "rgba(255,167,38,0.12)"  },
  error:    { fg: "#ef5350",               bg: "rgba(239,83,80,0.13)"   },
  critical: { fg: "#ff5252",               bg: "rgba(255,82,82,0.20)"   },
  thought:  { fg: "#ba68c8",               bg: "rgba(186,104,200,0.13)" },
};

function LevelBadge({ level }: { level: string }) {
  const s = LEVEL_STYLES[level] ?? LEVEL_STYLES.info;
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        px: 0.75,
        py: 0.2,
        borderRadius: "4px",
        fontSize: "0.6rem",
        fontWeight: 700,
        letterSpacing: "0.7px",
        textTransform: "uppercase",
        minWidth: 54,
        color: s.fg,
        bgcolor: s.bg,
        fontFamily: "monospace",
        flexShrink: 0,
        lineHeight: 1.6,
      }}
    >
      {level}
    </Box>
  );
}

function rowBg(level: string): string | undefined {
  if (level === "critical") return "rgba(255,82,82,0.07)";
  if (level === "error")    return "rgba(239,83,80,0.04)";
  if (level === "warning")  return "rgba(255,167,38,0.03)";
  return undefined;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function AgentDashboard() {
  const searchParams = useSearchParams();
  const [logs, setLogs]                           = useState<LogEntry[]>([]);
  const [autoRefresh, setAutoRefresh]             = useState(true);
  const [showAllLogs, setShowAllLogs]             = useState(false);
  const [searchQuery, setSearchQuery]             = useState("");
  const [renderCount, setRenderCount]             = useState(400);
  const [filter, setFilter]                       = useState<LogFilter>("all");
  const [chartMetric, setChartMetric]             = useState<ChartMetric>("activities");
  const [drilldownStart, setDrilldownStart]       = useState<number | null>(null);
  const [sessionDrilldownStart, setSessionDrilldownStart] = useState<number | null>(null);
  const [expandedLogId, setExpandedLogId]         = useState<number | null>(null);
  const [lastRefreshed, setLastRefreshed]         = useState<Date>(() => new Date());
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [endDate, setEndDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const { formatDate } = useTheme();
  const isMobile = useIsMobile();

  const deepLinkRunId      = (searchParams?.get("logRunId") || "").trim();
  const deepLinkTaskRunId  = (searchParams?.get("logTaskRunId") || "").trim();
  const deepLinkScheduleId = (searchParams?.get("logScheduleId") || "").trim();

  const fetchLogs = useCallback(() => {
    const url = new URL("/api/logs", window.location.origin);
    url.searchParams.set("limit", "all");
    url.searchParams.set("level", "all");
    url.searchParams.set("source", "all");
    if (deepLinkRunId)      url.searchParams.set("runId",       deepLinkRunId);
    if (deepLinkTaskRunId)  url.searchParams.set("taskRunId",   deepLinkTaskRunId);
    if (deepLinkScheduleId) url.searchParams.set("scheduleId",  deepLinkScheduleId);
    fetch(url.toString())
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) { setLogs(d); setLastRefreshed(new Date()); } })
      .catch(console.error);
  }, [deepLinkRunId, deepLinkTaskRunId, deepLinkScheduleId]);

  useEffect(() => { setRenderCount(showAllLogs ? 400 : 200); }, [showAllLogs, searchQuery]);

  useEffect(() => {
    fetchLogs();
    if (autoRefresh && !showAllLogs) {
      const id = setInterval(() => {
        if (document.visibilityState !== "visible") return;
        fetchLogs();
      }, 30_000);
      return () => clearInterval(id);
    }
  }, [autoRefresh, showAllLogs, fetchLogs]);

  useEffect(() => { setDrilldownStart(null); setSessionDrilldownStart(null); }, [startDate, endDate]);

  const data = useDashboardData({
    logs, startDate, endDate, filter, searchQuery,
    renderCount, chartMetric, drilldownStart, sessionDrilldownStart, formatDate,
  });

  // Health signal
  const errCount = data.stats.errors + data.stats.critical;
  const health   = errCount === 0 ? "ok" : errCount < 5 ? "warn" : "critical";
  const healthFg = health === "ok" ? "success.main" : health === "warn" ? "warning.main" : "error.main";
  const healthText = health === "ok" ? "All clear" : `${errCount} error${errCount !== 1 ? "s" : ""}`;

  // ── KPI data ──────────────────────────────────────────────────────────────

  const kpis = [
    { label: "Sessions",    value: String(data.sessionAnalytics.total),                          color: "primary.main"   },
    { label: "Engagement",  value: toPct(data.sessionAnalytics.engagementRate),                  color: "info.main"      },
    { label: "Resolution",  value: toPct(data.sessionAnalytics.resolutionRate),                  color: "success.main"   },
    { label: "Escalation",  value: toPct(data.sessionAnalytics.escalationRate),                  color: "warning.main"   },
    { label: "Abandon",     value: toPct(data.sessionAnalytics.abandonRate),                     color: "error.main"     },
    { label: "CSAT",        value: data.sessionAnalytics.csat.toFixed(1),                        color: "secondary.main" },
  ] as const;

  const logStats = [
    { key: "all"      as LogFilter, label: "All",      value: data.stats.total,    color: "primary.main"   },
    { key: "verbose"  as LogFilter, label: "Verbose",  value: data.stats.verbose,  color: "text.secondary" },
    { key: "warning"  as LogFilter, label: "Warn",     value: data.stats.warnings, color: "warning.main"   },
    { key: "error"    as LogFilter, label: "Error",    value: data.stats.errors,   color: "error.main"     },
    { key: "critical" as LogFilter, label: "Critical", value: data.stats.critical, color: "error.dark"     },
    { key: "thought"  as LogFilter, label: "Thought",  value: data.stats.thoughts, color: "secondary.main" },
  ] as const;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>Dashboard</Typography>
          <Box
            sx={{
              display: "flex", alignItems: "center", gap: 0.75,
              px: 1, py: 0.4, borderRadius: 1.5,
              border: 1, borderColor: "divider",
            }}
          >
            <Box
              sx={{
                width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                bgcolor: autoRefresh ? "success.main" : "text.disabled",
                transition: "background-color 0.3s",
              }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500, lineHeight: 1 }}>
              {autoRefresh ? "Live" : "Paused"}
            </Typography>
          </Box>
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <TextField
            type="date" size="small" label="From" value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            InputLabelProps={{ shrink: true }} sx={{ width: 148 }}
          />
          <TextField
            type="date" size="small" label="To" value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            InputLabelProps={{ shrink: true }} sx={{ width: 148 }}
          />
          <Tooltip title={autoRefresh ? "Pause auto-refresh" : "Resume auto-refresh"}>
            <IconButton
              size="small"
              onClick={() => setAutoRefresh((v) => !v)}
              sx={{ border: 1, borderColor: "divider", borderRadius: 1.5, p: 0.75 }}
            >
              <RefreshIcon sx={{ fontSize: 17, color: autoRefresh ? "success.main" : "text.disabled" }} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* ── BODY: sidebar + log stream ──────────────────────────────────────── */}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "272px 1fr" }, gap: 2, alignItems: "start" }}>

        {/* ── LEFT: metrics sidebar ─────────────────────────────────────────── */}
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.75 }}>

          {/* Health */}
          <Card variant="outlined">
            <CardContent sx={{ p: 1.75, "&:last-child": { pb: 1.75 }, display: "flex", alignItems: "center", gap: 1.5 }}>
              <Box sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: healthFg, flexShrink: 0 }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="caption" color="text.disabled" sx={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: 0.5, display: "block", lineHeight: 1 }}>
                  System health
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 600, color: healthFg, mt: 0.3 }}>
                  {healthText}
                </Typography>
              </Box>
              <Typography variant="caption" color="text.disabled" sx={{ fontFamily: "monospace", fontSize: "0.68rem", flexShrink: 0 }}>
                {formatDate(lastRefreshed.toISOString(), { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </Typography>
            </CardContent>
          </Card>

          {/* KPI 2×3 grid */}
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 1.25 }}>
            {kpis.map((m) => (
              <Card key={m.label} variant="outlined">
                <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
                  <Typography variant="caption" color="text.disabled" sx={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: 0.5, display: "block" }}>
                    {m.label}
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 700, color: m.color, mt: 0.25, lineHeight: 1.2 }}>
                    {m.value}
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </Box>

          {/* Log breakdown — clickable pills that filter the stream */}
          <Card variant="outlined">
            <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 } }}>
              <Typography variant="caption" color="text.disabled" sx={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: 0.5, display: "block", mb: 1 }}>
                Log breakdown
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                {logStats.map((s) => (
                  <Chip
                    key={s.key}
                    label={`${s.label}  ${s.value}`}
                    size="small"
                    variant={filter === s.key ? "filled" : "outlined"}
                    onClick={() => setFilter(filter === s.key && s.key !== "all" ? "all" : s.key)}
                    sx={{
                      height: 22, cursor: "pointer",
                      fontSize: "0.68rem",
                      "& .MuiChip-label": { px: 1 },
                      ...(filter !== s.key ? { color: s.color, borderColor: s.color } : {}),
                    }}
                  />
                ))}
              </Box>
            </CardContent>
          </Card>

          {/* Activity chart */}
          <Card variant="outlined">
            <Box sx={{ px: 2, pt: 1.75, pb: 0.5, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <Box>
                <Typography variant="caption" sx={{ fontWeight: 600, display: "block" }}>Activity</Typography>
                <Typography variant="caption" color="text.disabled" sx={{ fontSize: "0.6rem" }}>Click bucket → filter logs</Typography>
              </Box>
              <ToggleButtonGroup
                value={chartMetric} exclusive size="small"
                onChange={(_, v: ChartMetric | null) => { if (v) setChartMetric(v); }}
              >
                <ToggleButton value="activities" sx={{ py: 0.3, px: 0.9, fontSize: "0.65rem", minWidth: 0 }}>Act</ToggleButton>
                <ToggleButton value="errors"     sx={{ py: 0.3, px: 0.9, fontSize: "0.65rem", minWidth: 0 }}>Err</ToggleButton>
              </ToggleButtonGroup>
            </Box>
            <CardContent sx={{ pt: 1, pb: "12px !important" }}>
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 0.5, alignItems: "end" }}>
                {data.chartBuckets.map((bucket) => {
                  const isSelected  = drilldownStart === bucket.start;
                  const actH = Math.max((bucket.activities / data.chartMax) * 100, bucket.activities > 0 ? 3 : 0);
                  const errH = Math.max((bucket.errors    / data.chartMax) * 100, bucket.errors    > 0 ? 3 : 0);
                  return (
                    <Box
                      key={bucket.start}
                      onClick={() => { setSessionDrilldownStart(null); setDrilldownStart(isSelected ? null : bucket.start); }}
                      sx={{
                        borderRadius: 1, p: 0.5, cursor: "pointer",
                        border: 1,
                        borderColor: isSelected ? "primary.main" : "transparent",
                        bgcolor: isSelected ? "action.selected" : "transparent",
                        "&:hover": { bgcolor: "action.hover" },
                        transition: "all 0.12s",
                      }}
                    >
                      <Box sx={{ height: 52, display: "flex", alignItems: "flex-end", gap: "2px" }}>
                        <Box sx={{ flex: 1, height: `${actH}%`, minHeight: bucket.activities > 0 ? 2 : 0, bgcolor: "primary.main", opacity: 0.45, borderRadius: "2px 2px 0 0" }} />
                        <Box sx={{ flex: 1, height: `${errH}%`, minHeight: bucket.errors     > 0 ? 2 : 0, bgcolor: "error.main",   borderRadius: "2px 2px 0 0" }} />
                      </Box>
                      <Typography variant="caption" color="text.disabled" sx={{ display: "block", textAlign: "center", fontSize: "0.52rem", mt: 0.5, lineHeight: 1, fontFamily: "monospace" }}>
                        {bucket.label}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
              <Box sx={{ mt: 1, display: "flex", gap: 1.5 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: 0.5, bgcolor: "primary.main", opacity: 0.55 }} />
                  <Typography variant="caption" color="text.disabled" sx={{ fontSize: "0.58rem" }}>Activities</Typography>
                </Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                  <Box sx={{ width: 6, height: 6, borderRadius: 0.5, bgcolor: "error.main" }} />
                  <Typography variant="caption" color="text.disabled" sx={{ fontSize: "0.58rem" }}>Errors</Typography>
                </Box>
              </Box>
              {data.selectedBucket && (
                <Chip
                  size="small" variant="outlined"
                  label={formatDate(new Date(data.selectedBucket.start).toISOString(), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  onDelete={() => setDrilldownStart(null)}
                  sx={{ mt: 1, fontSize: "0.62rem", height: 20 }}
                />
              )}
            </CardContent>
          </Card>

          {/* Session outcomes chart */}
          <Card variant="outlined">
            <Box sx={{ px: 2, pt: 1.75, pb: 0.5 }}>
              <Typography variant="caption" sx={{ fontWeight: 600 }}>Session outcomes</Typography>
            </Box>
            <CardContent sx={{ pt: 1, pb: "12px !important" }}>
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 0.5, alignItems: "end" }}>
                {data.outcomesByBucket.map((row) => {
                  const maxVal   = Math.max(...data.outcomesByBucket.map((r) => r.resolved + r.escalated + r.abandoned), 1);
                  const rH = Math.max((row.resolved  / maxVal) * 100, row.resolved  > 0 ? 3 : 0);
                  const eH = Math.max((row.escalated / maxVal) * 100, row.escalated > 0 ? 3 : 0);
                  const aH = Math.max((row.abandoned / maxVal) * 100, row.abandoned > 0 ? 3 : 0);
                  const isSelected = sessionDrilldownStart === row.start;
                  return (
                    <Box
                      key={`out-${row.start}`}
                      onClick={() => { setDrilldownStart(null); setSessionDrilldownStart(isSelected ? null : row.start); }}
                      sx={{
                        borderRadius: 1, p: 0.5, cursor: "pointer",
                        border: 1,
                        borderColor: isSelected ? "secondary.main" : "transparent",
                        bgcolor: isSelected ? "action.selected" : "transparent",
                        "&:hover": { bgcolor: "action.hover" },
                        transition: "all 0.12s",
                      }}
                    >
                      <Box sx={{ height: 52, display: "flex", alignItems: "flex-end", gap: "1px" }}>
                        <Box sx={{ flex: 1, height: `${rH}%`, minHeight: row.resolved  > 0 ? 2 : 0, bgcolor: "success.main", borderRadius: "2px 2px 0 0" }} />
                        <Box sx={{ flex: 1, height: `${eH}%`, minHeight: row.escalated > 0 ? 2 : 0, bgcolor: "warning.main", borderRadius: "2px 2px 0 0" }} />
                        <Box sx={{ flex: 1, height: `${aH}%`, minHeight: row.abandoned > 0 ? 2 : 0, bgcolor: "error.main",   borderRadius: "2px 2px 0 0" }} />
                      </Box>
                      <Typography variant="caption" color="text.disabled" sx={{ display: "block", textAlign: "center", fontSize: "0.52rem", mt: 0.5, lineHeight: 1, fontFamily: "monospace" }}>
                        {row.label}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
              <Box sx={{ mt: 1, display: "flex", gap: 1.5 }}>
                {(["success.main", "warning.main", "error.main"] as const).map((c, i) => (
                  <Box key={c} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                    <Box sx={{ width: 6, height: 6, borderRadius: 0.5, bgcolor: c }} />
                    <Typography variant="caption" color="text.disabled" sx={{ fontSize: "0.58rem" }}>
                      {["Resolved", "Escalated", "Abandoned"][i]}
                    </Typography>
                  </Box>
                ))}
              </Box>
              {data.selectedSessionBucket && (
                <Chip
                  size="small" variant="outlined"
                  label={formatDate(new Date(data.selectedSessionBucket.start).toISOString(), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  onDelete={() => setSessionDrilldownStart(null)}
                  sx={{ mt: 1, fontSize: "0.62rem", height: 20 }}
                />
              )}
            </CardContent>
          </Card>

        </Box>

        {/* ── RIGHT: log stream ─────────────────────────────────────────────── */}
        <Card
          variant="outlined"
          sx={{
            display: "flex",
            flexDirection: "column",
            height: { xs: "72vh", lg: "calc(100vh - 152px)" },
            minHeight: 480,
            overflow: "hidden",
          }}
        >
          {/* Log header — sticky */}
          <Box sx={{ px: 2, pt: 1.75, pb: 1.5, borderBottom: 1, borderColor: "divider", flexShrink: 0 }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.25, gap: 1 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Live Logs</Typography>
                <Chip
                  size="small"
                  label={data.searchedLogs.length}
                  sx={{ height: 18, "& .MuiChip-label": { px: 0.75, fontSize: "0.62rem" } }}
                />
                {(data.selectedBucket || data.selectedSessionBucket) && (
                  <Chip
                    size="small" variant="outlined" color="primary"
                    label={data.selectedSessionBucket ? "Session filter" : `${chartMetric === "errors" ? "Errors" : "Activity"} filter`}
                    onDelete={() => { setDrilldownStart(null); setSessionDrilldownStart(null); }}
                    sx={{ height: 20, fontSize: "0.65rem" }}
                  />
                )}
                {filter !== "all" && (
                  <Chip
                    size="small" variant="outlined"
                    label={`${filter} only`}
                    onDelete={() => setFilter("all")}
                    sx={{ height: 20, fontSize: "0.65rem" }}
                  />
                )}
              </Box>

              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                <Tooltip title={showAllLogs ? "Showing all logs (click for latest 200)" : "Showing latest 200 (click to show all)"}>
                  <Chip
                    size="small"
                    label={showAllLogs ? "All" : "Latest 200"}
                    variant={showAllLogs ? "filled" : "outlined"}
                    onClick={() => setShowAllLogs((v) => !v)}
                    sx={{ height: 22, "& .MuiChip-label": { px: 1, fontSize: "0.65rem" }, cursor: "pointer" }}
                  />
                </Tooltip>
                <Tooltip title="Refresh">
                  <IconButton size="small" onClick={fetchLogs} sx={{ p: 0.5 }}>
                    <RefreshIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>

            <TextField
              fullWidth size="small"
              placeholder="Search logs, source, level, metadata…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 16, color: "text.disabled" }} />
                  </InputAdornment>
                ),
                endAdornment: searchQuery ? (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setSearchQuery("")} sx={{ p: 0.25 }}>
                      <CloseIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </InputAdornment>
                ) : undefined,
              }}
            />
          </Box>

          {/* Log rows — scrollable */}
          <Box sx={{ flex: 1, overflowY: "auto", py: 0.25 }}>
            {data.visibleLogs.length === 0 ? (
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", p: 6 }}>
                <Typography variant="body2" color="text.disabled">
                  {filter !== "all"
                    ? `No ${filter} logs in range`
                    : searchQuery.trim()
                      ? "No logs match your search"
                      : "No logs yet — start a conversation or check agent activity"}
                </Typography>
              </Box>
            ) : (
              <>
                {data.visibleLogs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  const meta       = parseMetadata(log.metadata);
                  const hasDetails = meta !== null;
                  const bg         = rowBg(log.level);

                  return (
                    <Box key={log.id}>
                      <Box
                        onClick={() => hasDetails && setExpandedLogId(isExpanded ? null : log.id)}
                        sx={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 1,
                          px: 1.75,
                          py: 0.55,
                          cursor: hasDetails ? "pointer" : "default",
                          bgcolor: isExpanded ? "action.selected" : bg,
                          borderLeft: "2px solid",
                          borderLeftColor:
                            log.level === "critical" ? "error.main"
                            : log.level === "error"   ? "rgba(239,83,80,0.4)"
                            : "transparent",
                          "&:hover": { bgcolor: isExpanded ? "action.selected" : "action.hover" },
                          transition: "background-color 0.1s",
                        }}
                      >
                        {/* Timestamp */}
                        <Typography
                          variant="caption"
                          sx={{
                            color: "text.disabled",
                            fontFamily: "monospace",
                            fontSize: "0.68rem",
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                            mt: 0.25,
                            minWidth: 64,
                          }}
                        >
                          {formatDate(log.created_at, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </Typography>

                        {/* Level badge */}
                        <LevelBadge level={log.level} />

                        {/* Source */}
                        {!isMobile && (
                          <Typography
                            variant="caption"
                            sx={{
                              fontFamily: "monospace",
                              fontSize: "0.64rem",
                              fontWeight: 600,
                              textTransform: "uppercase",
                              letterSpacing: "0.5px",
                              color: "text.disabled",
                              whiteSpace: "nowrap",
                              flexShrink: 0,
                              mt: 0.3,
                              minWidth: 96,
                            }}
                          >
                            {log.source || "system"}
                          </Typography>
                        )}

                        {/* Message */}
                        <Typography
                          variant="caption"
                          sx={{
                            flex: 1,
                            fontFamily: "monospace",
                            fontSize: "0.8rem",
                            lineHeight: 1.5,
                            wordBreak: "break-word",
                            color:
                              log.level === "critical" ? "error.light"
                              : log.level === "error"   ? "error.main"
                              : "text.primary",
                          }}
                        >
                          {log.message}
                        </Typography>

                        {/* Expand arrow */}
                        {hasDetails && (
                          isExpanded
                            ? <ExpandLessIcon sx={{ fontSize: 15, color: "text.disabled", flexShrink: 0, mt: 0.35 }} />
                            : <ExpandMoreIcon sx={{ fontSize: 15, color: "text.disabled", flexShrink: 0, mt: 0.35 }} />
                        )}
                      </Box>

                      {/* Expanded metadata */}
                      <Collapse in={isExpanded} unmountOnExit>
                        <Box
                          sx={{
                            mx: 2, mb: 0.5, mt: 0.25, p: 1.5,
                            bgcolor: "action.hover",
                            borderRadius: 1.5,
                            borderLeft: 3,
                            borderColor: "primary.main",
                          }}
                        >
                          <Typography
                            variant="caption"
                            color="text.disabled"
                            sx={{ fontWeight: 600, fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: 0.5, display: "block", mb: 0.75 }}
                          >
                            Details
                          </Typography>
                          {meta && Object.entries(meta).map(([key, val]) => (
                            <Box key={key} sx={{ display: "flex", gap: 2, mb: 0.4 }}>
                              <Typography
                                component="span"
                                sx={{ color: "text.disabled", fontFamily: "monospace", fontSize: "0.7rem", minWidth: 120, flexShrink: 0 }}
                              >
                                {key}
                              </Typography>
                              <Typography
                                component="span"
                                sx={{ fontFamily: "monospace", fontSize: "0.7rem", wordBreak: "break-all", whiteSpace: "pre-wrap", color: "text.primary", flex: 1 }}
                              >
                                {formatMetaValue(val)}
                              </Typography>
                            </Box>
                          ))}
                        </Box>
                      </Collapse>
                    </Box>
                  );
                })}

                {/* Load more */}
                {data.searchedLogs.length > data.visibleLogs.length && (
                  <Box sx={{ p: 2, display: "flex", justifyContent: "center" }}>
                    <Button variant="outlined" size="small" onClick={() => setRenderCount((prev) => prev + 400)}>
                      Load {data.searchedLogs.length - data.visibleLogs.length} more
                    </Button>
                  </Box>
                )}
              </>
            )}
          </Box>
        </Card>

      </Box>
    </Box>
  );
}
