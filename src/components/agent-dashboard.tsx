"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface LogEntry {
  id: number;
  level: string;
  source: string | null;
  message: string;
  metadata: string | null;
  created_at: string;
}

export function AgentDashboard() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchLogs = () => {
    fetch("/api/logs?limit=200")
      .then((r) => r.json())
      .then(setLogs)
      .catch(console.error);
  };

  useEffect(() => {
    fetchLogs();
    if (autoRefresh) {
      const interval = setInterval(fetchLogs, 5000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh]);

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Agent Dashboard</h2>
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={() => setAutoRefresh(!autoRefresh)}
              className="mr-2"
            />
            Auto-refresh
          </label>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Total Logs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{logs.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Errors</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">
              {logs.filter((l) => l.level === "error").length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Thoughts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-500">
              {logs.filter((l) => l.level === "thought").length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">HITL Events</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-500">
              {logs.filter((l) => l.source === "hitl").length}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Log Stream */}
      <Card>
        <CardHeader>
          <CardTitle>Agent Log Stream</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[500px]">
            <div className="space-y-2">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-3 p-2 rounded-md hover:bg-muted/50 text-sm font-mono"
                >
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(log.created_at).toLocaleTimeString()}
                  </span>
                  <Badge variant={levelColor(log.level) as "default"}>
                    {log.level}
                  </Badge>
                  <span className={`text-xs font-bold uppercase ${sourceColor(log.source)}`}>
                    {log.source || "sys"}
                  </span>
                  <span className="flex-1">{log.message}</span>
                </div>
              ))}
              {logs.length === 0 && (
                <div className="text-center text-muted-foreground py-8">
                  No agent logs yet. Start a conversation or enable proactive scanning.
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
