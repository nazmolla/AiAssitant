import { useMemo } from "react";
import type {
  LogEntry,
  LogFilter,
  ChartMetric,
  TimeBucket,
  SessionRecord,
  DriverRow,
} from "@/lib/dashboard-analytics";
import { extractSessionKey, inferOutcome, inferTopic } from "@/lib/dashboard-analytics";

interface UseDashboardDataOptions {
  logs: LogEntry[];
  startDate: string;
  endDate: string;
  filter: LogFilter;
  searchQuery: string;
  renderCount: number;
  chartMetric: ChartMetric;
  drilldownStart: number | null;
  sessionDrilldownStart: number | null;
  formatDate: (iso: string, opts?: Intl.DateTimeFormatOptions) => string;
}

interface SessionAnalytics {
  sessions: SessionRecord[];
  total: number;
  resolved: number;
  escalated: number;
  abandoned: number;
  engaged: number;
  engagementRate: number;
  resolutionRate: number;
  escalationRate: number;
  abandonRate: number;
  csat: number;
}

interface OutcomeBucketRow {
  start: number;
  label: string;
  resolved: number;
  escalated: number;
  abandoned: number;
}

interface LogStats {
  total: number;
  verbose: number;
  warnings: number;
  errors: number;
  critical: number;
  thoughts: number;
}

interface DriverRowSet {
  resolved: DriverRow[];
  escalated: DriverRow[];
  abandoned: DriverRow[];
}

export interface DashboardData {
  logsInRange: LogEntry[];
  filteredLogs: LogEntry[];
  sessionAnalytics: SessionAnalytics;
  chartBuckets: TimeBucket[];
  outcomesByBucket: OutcomeBucketRow[];
  driverRows: DriverRowSet;
  drilldownLogs: LogEntry[];
  stats: LogStats;
  searchedLogs: LogEntry[];
  visibleLogs: LogEntry[];
  chartMax: number;
  sessionsMax: number;
  selectedBucket: TimeBucket | null;
  selectedSessionBucket: TimeBucket | null;
}

export function useDashboardData(options: UseDashboardDataOptions): DashboardData {
  const {
    logs,
    startDate,
    endDate,
    filter,
    searchQuery,
    renderCount,
    chartMetric,
    drilldownStart,
    sessionDrilldownStart,
    formatDate,
  } = options;

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

  const sessionAnalytics = useMemo<SessionAnalytics>(() => {
    const sessionsMap = new Map<string, LogEntry[]>();
    for (const log of logsInRange) {
      const sessionId = extractSessionKey(log.metadata);
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

  const outcomesByBucket = useMemo<OutcomeBucketRow[]>(() => {
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

  const driverRows = useMemo<DriverRowSet>(() => {
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
      const bucket = chartBuckets.find((b) => b.start === sessionDrilldownStart);
      if (!bucket) return filteredLogs;
      return filteredLogs.filter((log) => {
        const ts = new Date(log.created_at).getTime();
        if (Number.isNaN(ts) || ts < bucket.start || ts >= bucket.end) return false;
        return extractSessionKey(log.metadata) !== null;
      });
    }

    if (drilldownStart === null) return filteredLogs;
    const bucket = chartBuckets.find((b) => b.start === drilldownStart);
    if (!bucket) return filteredLogs;

    return filteredLogs.filter((log) => {
      const ts = new Date(log.created_at).getTime();
      if (Number.isNaN(ts) || ts < bucket.start || ts >= bucket.end) return false;
      if (chartMetric === "errors") return log.level === "error" || log.level === "critical";
      return true;
    });
  }, [filteredLogs, drilldownStart, sessionDrilldownStart, chartBuckets, chartMetric]);

  const stats = useMemo<LogStats>(() => {
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
    return { total: logsInRange.length, verbose, warnings, errors, critical, thoughts };
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

  return {
    logsInRange,
    filteredLogs,
    sessionAnalytics,
    chartBuckets,
    outcomesByBucket,
    driverRows,
    drilldownLogs,
    stats,
    searchedLogs,
    visibleLogs,
    chartMax,
    sessionsMax,
    selectedBucket,
    selectedSessionBucket,
  };
}
