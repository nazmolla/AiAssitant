"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTheme } from "@/components/theme-provider";

interface LogEntry {
  id: number;
  level: string;
  source: string | null;
  message: string;
  metadata: string | null;
  created_at: string;
}

type LogFilter = "all" | "error" | "thought" | "hitl";

export function AgentDashboard() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filter, setFilter] = useState<LogFilter>("all");
  const { formatDate } = useTheme();

  const fetchLogs = () => {
    fetch("/api/logs?limit=200")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setLogs(d); })
      .catch(console.error);
  };

  useEffect(() => {
    fetchLogs();
    if (autoRefresh) {
      const interval = setInterval(fetchLogs, 5000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

  const filteredLogs = logs.filter((l) => {
    if (filter === "all") return true;
    if (filter === "error") return l.level === "error";
    if (filter === "thought") return l.level === "thought";
    if (filter === "hitl") return l.source === "hitl";
    return true;
  });

  const levelColor = (level: string) => {
    switch (level) {
      case "error": return "destructive";
      case "warn": return "warning";
      case "thought": return "secondary";
      default: return "outline";
    }
  };

  const sourceColor = (source: string | null) => {
    switch (source) {
      case "agent": return "text-blue-400";
      case "scheduler": return "text-purple-400";
      case "mcp": return "text-green-400";
      case "hitl": return "text-yellow-400";
      default: return "text-muted-foreground";
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-display font-bold gradient-text">Agent Dashboard</h2>
          <p className="text-sm text-muted-foreground/60 font-light mt-1">Real-time activity and diagnostics</p>
        </div>
        <label className="flex items-center gap-2.5 text-[13px] text-muted-foreground cursor-pointer bg-white/[0.03] border border-white/[0.06] rounded-xl px-3.5 py-2 hover:bg-white/[0.05] transition-all duration-300 self-start sm:self-auto">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={() => setAutoRefresh(!autoRefresh)}
            className="rounded accent-primary"
          />
          Auto-refresh
        </label>
      </div>

      {/* Stats Cards — clickable to filter logs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <Card
          className={`group cursor-pointer transition-all duration-300 ${filter === "all" ? "border-primary/30 bg-primary/5" : "hover:border-primary/20"}`}
          onClick={() => setFilter(filter === "all" ? "all" : "all")}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground/70 uppercase tracking-wider font-normal">Total Logs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl sm:text-3xl font-display font-bold">{logs.length}</div>
          </CardContent>
        </Card>
        <Card
          className={`group cursor-pointer transition-all duration-300 ${filter === "error" ? "border-red-500/30 bg-red-500/5" : "hover:border-red-500/20"}`}
          onClick={() => setFilter(filter === "error" ? "all" : "error")}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground/70 uppercase tracking-wider font-normal">Errors</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl sm:text-3xl font-display font-bold text-red-400">
              {logs.filter((l) => l.level === "error").length}
            </div>
          </CardContent>
        </Card>
        <Card
          className={`group cursor-pointer transition-all duration-300 ${filter === "thought" ? "border-blue-500/30 bg-blue-500/5" : "hover:border-blue-500/20"}`}
          onClick={() => setFilter(filter === "thought" ? "all" : "thought")}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground/70 uppercase tracking-wider font-normal">Thoughts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl sm:text-3xl font-display font-bold text-blue-400">
              {logs.filter((l) => l.level === "thought").length}
            </div>
          </CardContent>
        </Card>
        <Card
          className={`group cursor-pointer transition-all duration-300 ${filter === "hitl" ? "border-yellow-500/30 bg-yellow-500/5" : "hover:border-yellow-500/20"}`}
          onClick={() => setFilter(filter === "hitl" ? "all" : "hitl")}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-xs text-muted-foreground/70 uppercase tracking-wider font-normal">HITL Events</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl sm:text-3xl font-display font-bold text-yellow-400">
              {logs.filter((l) => l.source === "hitl").length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active filter indicator */}
      {filter !== "all" && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground/60">Filtering:</span>
          <Badge variant="outline" className="text-xs">
            {filter === "error" ? "Errors only" : filter === "thought" ? "Thoughts only" : "HITL events only"}
          </Badge>
          <button onClick={() => setFilter("all")} className="text-xs text-muted-foreground/60 hover:text-foreground transition-colors">
            Clear
          </button>
        </div>
      )}

      {/* Log Stream */}
      <Card>
        <CardHeader>
          <CardTitle className="gradient-text">Agent Log Stream</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            <div className="space-y-1">
              {filteredLogs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-3 p-2.5 rounded-xl hover:bg-white/[0.03] text-sm font-mono transition-colors duration-200"
                >
                  <span className="text-[11px] text-muted-foreground/50 whitespace-nowrap font-light">
                    {formatDate(log.created_at, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  <Badge variant={levelColor(log.level) as "default"}>
                    {log.level}
                  </Badge>
                  <span className={`text-[11px] font-bold uppercase tracking-wider ${sourceColor(log.source)}`}>
                    {log.source || "sys"}
                  </span>
                  <span className="flex-1 text-foreground/80">{log.message}</span>
                </div>
              ))}
              {filteredLogs.length === 0 && (
                <div className="text-center text-muted-foreground/60 py-12 text-sm font-light">
                  {filter !== "all" ? `No ${filter} logs found.` : "No agent logs yet. Start a conversation or enable proactive scanning."}
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
