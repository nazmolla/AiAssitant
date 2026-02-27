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

export function AgentDashboard() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showAllLogs, setShowAllLogs] = useState(false);
  const [renderCount, setRenderCount] = useState(400);
  const [filter, setFilter] = useState<LogFilter>("all");
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);
  const { formatDate } = useTheme();

  const fetchLogs = useCallback(() => {
    const limit = showAllLogs ? "all" : "200";
    const level = filter === "thought" || filter === "all" ? "all" : filter;
    const source = filter === "thought" ? "thought" : "all";
    fetch(`/api/logs?limit=${limit}&level=${level}&source=${source}`)
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setLogs(d); })
      .catch(console.error);
  }, [showAllLogs, filter]);

  useEffect(() => {
    setRenderCount(showAllLogs ? 400 : 200);
  }, [showAllLogs]);

  useEffect(() => {
    fetchLogs();
    const shouldAutoRefresh = autoRefresh && !showAllLogs;
    if (shouldAutoRefresh) {
      const interval = setInterval(fetchLogs, 15000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, showAllLogs, fetchLogs]);

  const filteredLogs = useMemo(() => logs.filter((l) => {
    if (filter === "all") return true;
    if (filter === "thought") return l.source === "thought";
    if (filter === "verbose") return l.level === "verbose";
    if (filter === "warning") return l.level === "warning";
    if (filter === "error") return l.level === "error";
    if (filter === "critical") return l.level === "critical";
    return true;
  }), [logs, filter]);

  // Memoize stat counts to avoid re-computing on every render
  const stats = useMemo(() => {
    let verbose = 0;
    let warnings = 0;
    let errors = 0;
    let critical = 0;
    let thoughts = 0;
    for (const log of logs) {
      if (log.level === "verbose") verbose += 1;
      if (log.level === "warning") warnings += 1;
      if (log.level === "error") errors += 1;
      if (log.level === "critical") critical += 1;
      if (log.source === "thought") thoughts += 1;
    }
    return {
      total: logs.length,
      verbose,
      warnings,
      errors,
      critical,
      thoughts,
    };
  }, [logs]);

  const visibleLogs = useMemo(() => filteredLogs.slice(0, renderCount), [filteredLogs, renderCount]);
  const isMobile = useIsMobile();

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box sx={{ display: "flex", flexDirection: { xs: "column", sm: "row" }, alignItems: { sm: "center" }, justifyContent: "space-between", gap: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>Agent Dashboard</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Real-time activity and diagnostics</Typography>
        </Box>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
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

      {/* Stats Cards — clickable to filter logs */}
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

      {/* Log Filters */}
      <Box sx={{ borderRadius: 2, border: 1, borderColor: "divider", p: 1.5 }}>
        <Typography variant="overline" color="text.secondary" sx={{ fontSize: "0.65rem", mb: 1, display: "block" }}>Log Filters</Typography>
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
                          {formatDate(log.created_at, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
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
                          {formatDate(log.created_at, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
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

              {filteredLogs.length === 0 && (
                <Box sx={{ textAlign: "center", py: 6 }}>
                  <Typography variant="body2" color="text.secondary">
                    {filter !== "all" ? `No ${filter} logs found.` : "No agent logs yet. Start a conversation or enable proactive scanning."}
                  </Typography>
                </Box>
              )}
              {filteredLogs.length > visibleLogs.length && (
                <Box sx={{ pt: 1, display: "flex", justifyContent: "center" }}>
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => setRenderCount((prev) => prev + 400)}
                  >
                    Load more logs ({filteredLogs.length - visibleLogs.length} remaining)
                  </Button>
                </Box>
              )}
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
