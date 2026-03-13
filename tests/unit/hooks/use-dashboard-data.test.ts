/**
 * Unit tests for use-dashboard-data hook.
 * @jest-environment jsdom
 */
import { renderHook } from "@testing-library/react";
import { useDashboardData } from "@/hooks/use-dashboard-data";
import type { LogEntry, LogFilter, ChartMetric } from "@/lib/dashboard-analytics";

function mkLog(overrides: Partial<LogEntry> & { created_at: string }): LogEntry {
  return { id: Math.random(), level: "verbose", source: null, message: "", metadata: null, ...overrides };
}

const baseDate = "2024-06-01";
const formatDate = (iso: string, opts?: Intl.DateTimeFormatOptions) => {
  return new Date(iso).toLocaleString("en-US", opts);
};

function renderDashboard(overrides: Partial<Parameters<typeof useDashboardData>[0]> = {}) {
  return renderHook(() =>
    useDashboardData({
      logs: [],
      startDate: baseDate,
      endDate: baseDate,
      filter: "all" as LogFilter,
      searchQuery: "",
      renderCount: 100,
      chartMetric: "activities" as ChartMetric,
      drilldownStart: null,
      sessionDrilldownStart: null,
      formatDate,
      ...overrides,
    })
  );
}

describe("useDashboardData", () => {
  test("returns empty data when no logs provided", () => {
    const { result } = renderDashboard();
    expect(result.current.logsInRange).toEqual([]);
    expect(result.current.filteredLogs).toEqual([]);
    expect(result.current.stats.total).toBe(0);
    expect(result.current.sessionAnalytics.total).toBe(0);
    expect(result.current.chartMax).toBe(1);
    expect(result.current.sessionsMax).toBe(1);
  });

  test("filters logs by date range", () => {
    const logs: LogEntry[] = [
      mkLog({ created_at: "2024-06-01T12:00:00Z", message: "in range" }),
      mkLog({ created_at: "2024-05-31T12:00:00Z", message: "before" }),
      mkLog({ created_at: "2024-06-02T12:00:00Z", message: "after" }),
    ];
    const { result } = renderDashboard({ logs });
    expect(result.current.logsInRange).toHaveLength(1);
    expect(result.current.logsInRange[0].message).toBe("in range");
  });

  test("filters by level", () => {
    const logs: LogEntry[] = [
      mkLog({ created_at: "2024-06-01T10:00:00Z", level: "verbose" }),
      mkLog({ created_at: "2024-06-01T11:00:00Z", level: "error" }),
      mkLog({ created_at: "2024-06-01T12:00:00Z", level: "warning" }),
    ];
    const { result } = renderDashboard({ logs, filter: "error" as LogFilter });
    expect(result.current.filteredLogs).toHaveLength(1);
    expect(result.current.filteredLogs[0].level).toBe("error");
  });

  test("computes stats from logs in range", () => {
    const logs: LogEntry[] = [
      mkLog({ created_at: "2024-06-01T10:00:00Z", level: "verbose" }),
      mkLog({ created_at: "2024-06-01T11:00:00Z", level: "error" }),
      mkLog({ created_at: "2024-06-01T12:00:00Z", level: "warning" }),
      mkLog({ created_at: "2024-06-01T13:00:00Z", level: "critical" }),
      mkLog({ created_at: "2024-06-01T14:00:00Z", level: "verbose", source: "thought" }),
    ];
    const { result } = renderDashboard({ logs });
    expect(result.current.stats.total).toBe(5);
    expect(result.current.stats.verbose).toBe(2);
    expect(result.current.stats.warnings).toBe(1);
    expect(result.current.stats.errors).toBe(1);
    expect(result.current.stats.critical).toBe(1);
    expect(result.current.stats.thoughts).toBe(1);
  });

  test("search filters drilldown logs by query", () => {
    const logs: LogEntry[] = [
      mkLog({ created_at: "2024-06-01T10:00:00Z", message: "user login succeeded" }),
      mkLog({ created_at: "2024-06-01T11:00:00Z", message: "database connection error" }),
      mkLog({ created_at: "2024-06-01T12:00:00Z", message: "user logout" }),
    ];
    const { result } = renderDashboard({ logs, searchQuery: "user" });
    expect(result.current.searchedLogs).toHaveLength(2);
  });

  test("visibleLogs limits by renderCount", () => {
    const logs: LogEntry[] = Array.from({ length: 10 }, (_, i) =>
      mkLog({ created_at: `2024-06-01T${String(i + 10).padStart(2, "0")}:00:00Z`, message: `log-${i}` })
    );
    const { result } = renderDashboard({ logs, renderCount: 3 });
    expect(result.current.visibleLogs).toHaveLength(3);
  });

  test("creates chart buckets", () => {
    const logs: LogEntry[] = [
      mkLog({ created_at: "2024-06-01T06:00:00Z" }),
      mkLog({ created_at: "2024-06-01T18:00:00Z" }),
    ];
    const { result } = renderDashboard({ logs });
    expect(result.current.chartBuckets.length).toBe(8);
    expect(result.current.chartBuckets[0]).toHaveProperty("start");
    expect(result.current.chartBuckets[0]).toHaveProperty("activities");
    expect(result.current.chartBuckets[0]).toHaveProperty("errors");
    expect(result.current.chartBuckets[0]).toHaveProperty("sessions");
  });

  test("computes session analytics from metadata", () => {
    const logs: LogEntry[] = [
      mkLog({ created_at: "2024-06-01T10:00:00Z", message: "task completed", metadata: '{"sessionId":"s1"}' }),
      mkLog({ created_at: "2024-06-01T10:01:00Z", message: "followup", metadata: '{"sessionId":"s1"}' }),
      mkLog({ created_at: "2024-06-01T11:00:00Z", message: "user abandoned session", metadata: '{"sessionId":"s2"}' }),
    ];
    const { result } = renderDashboard({ logs });
    expect(result.current.sessionAnalytics.total).toBe(2);
    expect(result.current.sessionAnalytics.sessions).toHaveLength(2);
  });

  test("selectedBucket is null when no drilldown", () => {
    const { result } = renderDashboard();
    expect(result.current.selectedBucket).toBeNull();
    expect(result.current.selectedSessionBucket).toBeNull();
  });

  test("chartMax returns at least 1", () => {
    const { result } = renderDashboard({ logs: [] });
    expect(result.current.chartMax).toBe(1);
    expect(result.current.sessionsMax).toBe(1);
  });
});
