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
import { useDashboardData } from "@/hooks/use-dashboard-data";
import type { LogEntry, LogFilter, ChartMetric, DashboardView } from "@/lib/dashboard-analytics";
import { levelColor, sourceColor, parseMetadata, formatMetaValue, toPct } from "@/lib/dashboard-analytics";

export function AgentDashboard() {
  const searchParams = useSearchParams();
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

  const deepLinkRunId = (searchParams?.get("logRunId") || "").trim();
  const deepLinkTaskRunId = (searchParams?.get("logTaskRunId") || "").trim();
  const deepLinkScheduleId = (searchParams?.get("logScheduleId") || "").trim();
  const deepLinkView = (searchParams?.get("dashboardView") || "").trim();

  useEffect(() => {
    if (deepLinkView === "details") setDashboardView("details");
  }, [deepLinkView]);

  const fetchLogs = useCallback(() => {
    const url = new URL("/api/logs", window.location.origin);
    url.searchParams.set("limit", "all");
    url.searchParams.set("level", "all");
    url.searchParams.set("source", "all");
    if (deepLinkRunId) url.searchParams.set("runId", deepLinkRunId);
    if (deepLinkTaskRunId) url.searchParams.set("taskRunId", deepLinkTaskRunId);
    if (deepLinkScheduleId) url.searchParams.set("scheduleId", deepLinkScheduleId);

    fetch(url.toString())
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setLogs(d); })
      .catch(console.error);
  }, [deepLinkRunId, deepLinkTaskRunId, deepLinkScheduleId]);

  useEffect(() => { setRenderCount(showAllLogs ? 400 : 200); }, [showAllLogs, searchQuery]);

  useEffect(() => {
    fetchLogs();
    const shouldAutoRefresh = autoRefresh && !showAllLogs;
    if (shouldAutoRefresh) {
      const interval = setInterval(() => {
        if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
        fetchLogs();
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, showAllLogs, fetchLogs]);

  const data = useDashboardData({
    logs, startDate, endDate, filter, searchQuery,
    renderCount, chartMetric, drilldownStart, sessionDrilldownStart, formatDate,
  });

  const isMobile = useIsMobile();

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
          <TextField type="date" size="small" label="Start" value={startDate} onChange={(e) => setStartDate(e.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField type="date" size="small" label="End" value={endDate} onChange={(e) => setEndDate(e.target.value)} InputLabelProps={{ shrink: true }} />
          <FormControlLabel control={<MuiSwitch size="small" checked={showAllLogs} onChange={() => setShowAllLogs(!showAllLogs)} />} label={<Typography variant="caption">Show all logs</Typography>} />
          <FormControlLabel control={<MuiSwitch size="small" checked={autoRefresh} onChange={() => setAutoRefresh(!autoRefresh)} />} label={<Typography variant="caption">Auto-refresh</Typography>} />
        </Box>
      </Box>

      <Box sx={{ display: "flex", flexDirection: { xs: "column", sm: "row" }, alignItems: { sm: "center" }, justifyContent: "space-between", gap: 1, border: 1, borderColor: "divider", borderRadius: 2, p: 1.25, bgcolor: "background.paper" }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, letterSpacing: 0.6 }}>Dashboard View</Typography>
        <ToggleButtonGroup value={dashboardView} exclusive size="small" fullWidth={isMobile} onChange={(_, val: DashboardView | null) => { if (!val) return; setDashboardView(val); }}>
          <ToggleButton value="graphs">Graphs</ToggleButton>
          <ToggleButton value="details">Details</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {dashboardView === "graphs" && (
        <>
      {/* KPI Cards */}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(3, 1fr)", lg: "repeat(6, 1fr)" }, gap: { xs: 1.5, sm: 2 } }}>
        {([
          { label: "Sessions", value: data.sessionAnalytics.total, color: "primary.main" },
          { label: "Engagement", value: toPct(data.sessionAnalytics.engagementRate), color: "info.main" },
          { label: "Resolution", value: toPct(data.sessionAnalytics.resolutionRate), color: "success.main" },
          { label: "Escalation", value: toPct(data.sessionAnalytics.escalationRate), color: "warning.main" },
          { label: "Abandon", value: toPct(data.sessionAnalytics.abandonRate), color: "error.main" },
          { label: "CSAT", value: data.sessionAnalytics.csat.toFixed(1), color: "secondary.main" },
        ] as const).map((metric) => (
          <Card key={metric.label} variant="outlined">
            <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
              <Typography variant="overline" color="text.secondary" sx={{ fontSize: "0.65rem" }}>{metric.label}</Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, color: metric.color }}>{metric.value}</Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      {/* Summary Cards */}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(3, 1fr)", lg: "repeat(6, 1fr)" }, gap: { xs: 1.5, sm: 2 } }}>
        {([
          { key: "all" as LogFilter, label: "Total Logs", value: data.stats.total, color: "primary.main" },
          { key: "verbose" as LogFilter, label: "Verbose", value: data.stats.verbose, color: "info.main" },
          { key: "warning" as LogFilter, label: "Warnings", value: data.stats.warnings, color: "warning.main" },
          { key: "error" as LogFilter, label: "Errors", value: data.stats.errors, color: "error.main" },
          { key: "critical" as LogFilter, label: "Critical", value: data.stats.critical, color: "error.dark" },
          { key: "thought" as LogFilter, label: "Thoughts", value: data.stats.thoughts, color: "secondary.main" },
        ] as const).map((stat) => (
          <Card key={stat.key} variant="outlined" sx={{ cursor: "pointer", transition: "all 0.2s", borderColor: filter === stat.key ? stat.color : "divider", bgcolor: filter === stat.key ? "action.selected" : undefined, "&:hover": { borderColor: stat.color } }} onClick={() => setFilter(stat.key === filter && stat.key !== "all" ? "all" : stat.key)}>
            <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
              <Typography variant="overline" color="text.secondary" sx={{ fontSize: "0.65rem" }}>{stat.label}</Typography>
              <Typography variant="h4" sx={{ fontWeight: 700, color: stat.color }}>{stat.value}</Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      {/* Errors vs Activities Chart */}
      <Card variant="outlined">
        <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider", display: "flex", flexDirection: { xs: "column", sm: "row" }, gap: 1.5, alignItems: { sm: "center" }, justifyContent: "space-between" }}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Errors &amp; Activities (Last 24h)</Typography>
            <Typography variant="caption" color="text.secondary">Click any time bucket to drill down into detailed logs.</Typography>
          </Box>
          <ToggleButtonGroup value={chartMetric} exclusive size="small" onChange={(_, val: ChartMetric | null) => { if (!val) return; setChartMetric(val); }}>
            <ToggleButton value="activities">Activities</ToggleButton>
            <ToggleButton value="errors">Errors</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        <CardContent sx={{ pt: 2 }}>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(8, minmax(0, 1fr))", gap: 1, alignItems: "end" }}>
            {data.chartBuckets.map((bucket) => {
              const isSelected = drilldownStart === bucket.start;
              const mainValue = chartMetric === "activities" ? bucket.activities : bucket.errors;
              const activitiesHeight = (bucket.activities / data.chartMax) * 100;
              const errorsHeight = (bucket.errors / data.chartMax) * 100;
              return (
                <Box key={bucket.start} onClick={() => { setSessionDrilldownStart(null); setDrilldownStart(isSelected ? null : bucket.start); }} sx={{ borderRadius: 1.5, p: 1, border: 1, borderColor: isSelected ? "primary.main" : "divider", cursor: "pointer", bgcolor: isSelected ? "action.selected" : "transparent", transition: "all 0.15s ease", "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" } }}>
                  <Typography variant="caption" sx={{ display: "block", textAlign: "center", fontWeight: 700 }}>{mainValue}</Typography>
                  <Box sx={{ position: "relative", height: 120, mt: 0.75 }}>
                    <Box sx={{ position: "absolute", bottom: 0, left: "22%", width: "24%", height: `${activitiesHeight}%`, minHeight: bucket.activities > 0 ? 3 : 0, bgcolor: "primary.main", opacity: 0.55, borderRadius: 0.75 }} />
                    <Box sx={{ position: "absolute", bottom: 0, right: "22%", width: "24%", height: `${errorsHeight}%`, minHeight: bucket.errors > 0 ? 3 : 0, bgcolor: "error.main", borderRadius: 0.75 }} />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", textAlign: "center", mt: 0.5 }}>{bucket.label}</Typography>
                </Box>
              );
            })}
          </Box>
          <Box sx={{ mt: 1.5, display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}><Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: "primary.main", opacity: 0.55 }} /><Typography variant="caption" color="text.secondary">Activities</Typography></Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}><Box sx={{ width: 10, height: 10, borderRadius: 0.5, bgcolor: "error.main" }} /><Typography variant="caption" color="text.secondary">Errors</Typography></Box>
            {data.selectedBucket && (
              <Chip size="small" variant="outlined" label={`Drilldown: ${formatDate(new Date(data.selectedBucket.start).toISOString(), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} - ${formatDate(new Date(data.selectedBucket.end).toISOString(), { hour: "2-digit", minute: "2-digit" })}`} onDelete={() => setDrilldownStart(null)} />
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
            {data.outcomesByBucket.map((row) => {
              const maxVal = Math.max(...data.outcomesByBucket.map((r) => r.resolved + r.escalated + r.abandoned), 1);
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
          { title: "Resolution rate drivers", rows: data.driverRows.resolved },
          { title: "Escalation rate drivers", rows: data.driverRows.escalated },
          { title: "Abandon rate drivers", rows: data.driverRows.abandoned },
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

      {/* Sessions Chart */}
      <Card variant="outlined">
        <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Sessions (Last 24h)</Typography>
          <Typography variant="caption" color="text.secondary">Unique sessions inferred from log metadata per time bucket. Click bucket to drill down.</Typography>
        </Box>
        <CardContent sx={{ pt: 2 }}>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(8, minmax(0, 1fr))", gap: 1, alignItems: "end" }}>
            {data.chartBuckets.map((bucket) => {
              const isSelected = sessionDrilldownStart === bucket.start;
              const sessionsHeight = (bucket.sessions / data.sessionsMax) * 100;
              return (
                <Box key={`session-${bucket.start}`} onClick={() => { setDrilldownStart(null); setSessionDrilldownStart(isSelected ? null : bucket.start); }} sx={{ borderRadius: 1.5, p: 1, border: 1, borderColor: isSelected ? "secondary.main" : "divider", cursor: "pointer", bgcolor: isSelected ? "action.selected" : "transparent", transition: "all 0.15s ease", "&:hover": { borderColor: "secondary.main", bgcolor: "action.hover" } }}>
                  <Typography variant="caption" sx={{ display: "block", textAlign: "center", fontWeight: 700 }}>{bucket.sessions}</Typography>
                  <Box sx={{ position: "relative", height: 120, mt: 0.75 }}>
                    <Box sx={{ position: "absolute", bottom: 0, left: "35%", width: "30%", height: `${sessionsHeight}%`, minHeight: bucket.sessions > 0 ? 3 : 0, bgcolor: "secondary.main", borderRadius: 0.75 }} />
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", textAlign: "center", mt: 0.5 }}>{bucket.label}</Typography>
                </Box>
              );
            })}
          </Box>
          {data.selectedSessionBucket && (
            <Box sx={{ mt: 1.5 }}>
              <Chip size="small" variant="outlined" label={`Session drilldown: ${formatDate(new Date(data.selectedSessionBucket.start).toISOString(), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })} - ${formatDate(new Date(data.selectedSessionBucket.end).toISOString(), { hour: "2-digit", minute: "2-digit" })}`} onDelete={() => setSessionDrilldownStart(null)} />
            </Box>
          )}
        </CardContent>
      </Card>
        </>
      )}

      {dashboardView === "details" && (
        <>
      <Box sx={{ borderRadius: 2, border: 1, borderColor: "divider", p: 1.5 }}>
        <Typography variant="overline" color="text.secondary" sx={{ fontSize: "0.65rem", mb: 1, display: "block" }}>Log Filters</Typography>
        <Box sx={{ mb: 1.25 }}><TextField fullWidth size="small" placeholder="Search logs, source, level, metadata..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} /></Box>
        <ToggleButtonGroup value={filter} exclusive onChange={(_, val) => { if (val !== null) setFilter(val); }} size="small" sx={{ flexWrap: "wrap", gap: 0.5 }}>
          {(["all", "verbose", "warning", "error", "critical", "thought"] as LogFilter[]).map((f) => (
            <ToggleButton key={f} value={f} sx={{ textTransform: "capitalize", px: 1.5, py: 0.5, fontSize: "0.75rem" }}>{f}</ToggleButton>
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

      <Card variant="outlined">
        <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Agent Log Stream {showAllLogs ? "(All)" : "(Latest 200)"}
          </Typography>
          {(data.selectedBucket || data.selectedSessionBucket) && (
            <Typography variant="caption" color="text.secondary">
              {data.selectedSessionBucket
                ? "Showing session-associated details for selected chart bucket."
                : `Showing ${chartMetric === "errors" ? "error" : "activity"} details for selected chart bucket.`}
            </Typography>
          )}
        </Box>
        <CardContent>
          <Box sx={{ height: 500, overflow: "auto" }}>
            {isMobile ? (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {data.visibleLogs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  const meta = parseMetadata(log.metadata);
                  const hasDetails = meta !== null;
                  return (
                    <Box key={log.id} sx={{ borderRadius: 2, border: 1, borderColor: isExpanded ? "primary.main" : "divider", p: 1.5, display: "flex", flexDirection: "column", gap: 0.5, cursor: hasDetails ? "pointer" : "default", transition: "border-color 0.2s", "&:hover": hasDetails ? { borderColor: "primary.light" } : {} }} onClick={() => hasDetails && setExpandedLogId(isExpanded ? null : log.id)}>
                      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                        <Typography variant="caption" color="text.secondary">{formatDate(log.created_at, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</Typography>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                          <Chip label={log.level} size="small" color={levelColor(log.level)} />
                          <Typography variant="caption" sx={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }} className={sourceColor(log.source)}>{log.source || "sys"}</Typography>
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
                {data.visibleLogs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  const meta = parseMetadata(log.metadata);
                  const hasDetails = meta !== null;
                  return (
                    <Box key={log.id}>
                      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5, p: 1, borderRadius: 2, fontFamily: "monospace", fontSize: "0.875rem", cursor: hasDetails ? "pointer" : "default", bgcolor: isExpanded ? "action.selected" : "transparent", "&:hover": { bgcolor: isExpanded ? "action.selected" : "action.hover" } }} onClick={() => hasDetails && setExpandedLogId(isExpanded ? null : log.id)}>
                        <Typography variant="caption" color="text.disabled" sx={{ whiteSpace: "nowrap", fontFamily: "monospace" }}>{formatDate(log.created_at, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</Typography>
                        <Chip label={log.level} size="small" color={levelColor(log.level)} />
                        <Typography variant="caption" sx={{ fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }} className={sourceColor(log.source)}>{log.source || "sys"}</Typography>
                        <Typography variant="body2" sx={{ flex: 1, fontFamily: "monospace" }}>{log.message}</Typography>
                        {hasDetails && (isExpanded ? <ExpandLessIcon sx={{ fontSize: 18, color: "text.secondary", mt: 0.25 }} /> : <ExpandMoreIcon sx={{ fontSize: 18, color: "text.secondary", mt: 0.25 }} />)}
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

              {data.searchedLogs.length === 0 && (
                <Box sx={{ textAlign: "center", py: 6 }}>
                  <Typography variant="body2" color="text.secondary">
                    {data.selectedSessionBucket
                      ? "No session-associated logs found in this bucket."
                      : data.selectedBucket
                        ? `No ${chartMetric === "errors" ? "error" : "activity"} logs found in this bucket.`
                      : (filter !== "all" ? `No ${filter} logs found.` : searchQuery.trim() !== "" ? "No logs match your search." : "No agent logs yet. Start a conversation or enable proactive scanning.")}
                  </Typography>
                </Box>
              )}
              {data.searchedLogs.length > data.visibleLogs.length && (
                <Box sx={{ pt: 1, display: "flex", justifyContent: "center" }}>
                  <Button variant="outlined" size="small" onClick={() => setRenderCount((prev) => prev + 400)}>
                    Load more logs ({data.searchedLogs.length - data.visibleLogs.length} remaining)
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
