"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

interface ToolPolicy {
  tool_name: string;
  mcp_id: string | null;
  requires_approval: number;
  is_proactive_enabled: number;
}

interface ToolDef {
  name: string;
  description: string;
}

interface McpServer {
  id: string;
  name: string;
}

export function ToolPolicies() {
  const [tools, setTools] = useState<ToolDef[]>([]);
  const [policies, setPolicies] = useState<ToolPolicy[]>([]);
  const [serverNames, setServerNames] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const fetchAll = useCallback(() => {
    fetch("/api/mcp/tools").then((r) => r.json()).then((d) => { if (Array.isArray(d)) setTools(d); }).catch(console.error);
    fetch("/api/policies").then((r) => r.json()).then((d) => { if (Array.isArray(d)) setPolicies(d); }).catch(console.error);
    fetch("/api/mcp").then((r) => r.json()).then((servers) => {
      if (!Array.isArray(servers)) return;
      const map: Record<string, string> = {};
      for (const s of servers) map[s.id] = s.name;
      setServerNames(map);
    }).catch(console.error);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function togglePolicy(toolName: string, field: "requires_approval" | "is_proactive_enabled", value: boolean) {
    const existing = policies.find((p) => p.tool_name === toolName);
    await fetch("/api/policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool_name: toolName,
        mcp_id: existing?.mcp_id || null,
        requires_approval: field === "requires_approval" ? value : existing?.requires_approval ?? true,
        is_proactive_enabled: field === "is_proactive_enabled" ? value : existing?.is_proactive_enabled ?? false,
      }),
    });
    fetchAll();
  }

  async function toggleAllPolicies(field: "requires_approval" | "is_proactive_enabled", value: boolean) {
    await Promise.all(
      tools.map((tool) => {
        const existing = policies.find((p) => p.tool_name === tool.name);
        return fetch("/api/policies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool_name: tool.name,
            mcp_id: existing?.mcp_id || null,
            requires_approval: field === "requires_approval" ? value : existing?.requires_approval ?? true,
            is_proactive_enabled: field === "is_proactive_enabled" ? value : existing?.is_proactive_enabled ?? false,
          }),
        });
      })
    );
    fetchAll();
  }

  async function toggleGroupPolicies(groupTools: ToolDef[], field: "requires_approval" | "is_proactive_enabled", value: boolean) {
    await Promise.all(
      groupTools.map((tool) => {
        const existing = policies.find((p) => p.tool_name === tool.name);
        return fetch("/api/policies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool_name: tool.name,
            mcp_id: existing?.mcp_id || null,
            requires_approval: field === "requires_approval" ? value : existing?.requires_approval ?? true,
            is_proactive_enabled: field === "is_proactive_enabled" ? value : existing?.is_proactive_enabled ?? false,
          }),
        });
      })
    );
    fetchAll();
  }

  if (tools.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="text-3xl mb-3 opacity-30">🛡️</div>
          <p className="text-sm text-muted-foreground/60 font-light">
            No tools discovered yet. Connect an MCP server first.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Group tools by MCP server
  const grouped = tools.reduce<Record<string, ToolDef[]>>((acc, tool) => {
    const dotIdx = tool.name.indexOf(".");
    const serverId = dotIdx !== -1 ? tool.name.substring(0, dotIdx) : "_unknown";
    if (!acc[serverId]) acc[serverId] = [];
    acc[serverId].push(tool);
    return acc;
  }, {});

  const serverIds = Object.keys(grouped);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>{tools.length} tool{tools.length !== 1 ? "s" : ""} discovered</span>
        <span className="text-muted-foreground/30">•</span>
        <span>{serverIds.length} server{serverIds.length !== 1 ? "s" : ""}</span>
        <span className="text-muted-foreground/30">•</span>
        <span>{policies.filter((p) => p.requires_approval).length} requiring approval</span>
        <span className="text-muted-foreground/30">•</span>
        <span>{policies.filter((p) => p.is_proactive_enabled).length} proactive</span>
      </div>

      {serverIds.map((serverId) => {
        const serverLabel = serverNames[serverId] || serverId;
        const serverTools = grouped[serverId];
        const isCollapsed = collapsed[serverId] ?? false;
        return (
          <Card key={serverId}>
            <CardHeader className="pb-0 pt-4 px-4">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setCollapsed((prev) => ({ ...prev, [serverId]: !isCollapsed }))}
                  className="flex items-center gap-2 text-left group"
                >
                  <span className={`text-[10px] text-muted-foreground/40 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-90'}`}>▶</span>
                  <CardTitle className="text-sm font-display font-semibold text-primary/90 group-hover:text-primary transition-colors">
                    {serverLabel}
                    <span className="ml-2 text-[11px] font-normal text-muted-foreground/50">
                      {serverTools.length} tool{serverTools.length !== 1 ? "s" : ""}
                    </span>
                  </CardTitle>
                </button>
                {!isCollapsed && (
                  <div className="flex items-center gap-3 text-[10px]">
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground/40 uppercase tracking-wider">Approval:</span>
                      <button onClick={() => toggleGroupPolicies(serverTools, "requires_approval", true)} className="text-primary/70 hover:text-primary transition-colors px-0.5">All</button>
                      <span className="text-muted-foreground/30">|</span>
                      <button onClick={() => toggleGroupPolicies(serverTools, "requires_approval", false)} className="text-muted-foreground/50 hover:text-primary transition-colors px-0.5">None</button>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground/40 uppercase tracking-wider">Proactive:</span>
                      <button onClick={() => toggleGroupPolicies(serverTools, "is_proactive_enabled", true)} className="text-primary/70 hover:text-primary transition-colors px-0.5">All</button>
                      <span className="text-muted-foreground/30">|</span>
                      <button onClick={() => toggleGroupPolicies(serverTools, "is_proactive_enabled", false)} className="text-muted-foreground/50 hover:text-primary transition-colors px-0.5">None</button>
                    </div>
                  </div>
                )}
              </div>
            </CardHeader>
            {!isCollapsed && (
            <CardContent className="p-0 pt-2">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/[0.06] text-left text-[11px] text-muted-foreground/50 uppercase tracking-wider">
                    <th className="px-4 py-2 font-medium">Tool</th>
                    <th className="px-4 py-2 font-medium">Description</th>
                    <th className="px-4 py-2 text-center font-medium">Approval</th>
                    <th className="px-4 py-2 text-center font-medium">Proactive</th>
                  </tr>
                </thead>
                <tbody>
                  {serverTools.map((tool) => {
                    const policy = policies.find((p) => p.tool_name === tool.name);
                    const dotIdx = tool.name.indexOf(".");
                    const toolName = dotIdx !== -1 ? tool.name.substring(dotIdx + 1) : tool.name;
                    return (
                      <tr key={tool.name} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors duration-200">
                        <td className="px-4 py-3 text-sm font-mono text-primary/80">{toolName}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground/60">
                          {tool.description.substring(0, 80)}
                          {tool.description.length > 80 ? "..." : ""}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Switch
                            checked={policy?.requires_approval !== 0}
                            onCheckedChange={(v) => togglePolicy(tool.name, "requires_approval", v)}
                          />
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Switch
                            checked={policy?.is_proactive_enabled === 1}
                            onCheckedChange={(v) => togglePolicy(tool.name, "is_proactive_enabled", v)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
