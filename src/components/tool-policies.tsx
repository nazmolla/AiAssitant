"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

interface ToolPolicy {
  tool_name: string;
  mcp_id: string | null;
  requires_approval: number;
  is_proactive_enabled: number;
  scope: "global" | "user";
}

interface ToolDef {
  name: string;
  description: string;
  source?: "builtin" | "custom" | "mcp";
  group?: string;
}

const GROUP_ICONS: Record<string, string> = {
  "Web Tools": "🌐",
  "Browser Tools": "🖥️",
  "File System": "📁",
  "Network Tools": "🔌",
  "Email Tools": "📧",
  "File Generation": "📝",
  "Tool Management": "🛠️",
  "Alexa Smart Home": "🔊",
  "Custom Tools": "🔧",
};

const BUILTIN_ORDER = ["Web Tools", "Browser Tools", "File System", "File Generation", "Network Tools", "Email Tools", "Alexa Smart Home", "Tool Management", "Custom Tools"];

export function ToolPolicies() {
  const [tools, setTools] = useState<ToolDef[]>([]);
  const [policies, setPolicies] = useState<ToolPolicy[]>([]);
  const [serverNames, setServerNames] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [isMobile, setIsMobile] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [toolsResp, policiesResp, serversResp] = await Promise.all([
        fetch("/api/mcp/tools").then((r) => r.json()).catch(() => []),
        fetch("/api/policies").then((r) => r.json()).catch(() => []),
        fetch("/api/mcp").then((r) => r.json()).catch(() => []),
      ]);

      setTools(Array.isArray(toolsResp) ? toolsResp : []);
      setPolicies(Array.isArray(policiesResp) ? policiesResp : []);

      if (Array.isArray(serversResp)) {
        const map: Record<string, string> = {};
        for (const s of serversResp) {
          map[s.id] = s.name;
        }
        setServerNames(map);
      } else {
        setServerNames({});
      }
    } catch (error) {
      console.error(error);
      setTools([]);
      setPolicies([]);
      setServerNames({});
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const policyMap = useMemo(() => {
    const map = new Map<string, ToolPolicy>();
    for (const policy of policies) {
      map.set(policy.tool_name, policy);
    }
    return map;
  }, [policies]);

  const grouped = useMemo(() => {
    const nextGrouped: Record<string, { tools: ToolDef[]; label: string; icon: string }> = {};

    for (const tool of tools) {
      if (tool.source === "builtin" || tool.source === "custom") {
        const groupKey = tool.group || "Other";
        if (!nextGrouped[groupKey]) {
          nextGrouped[groupKey] = {
            tools: [],
            label: groupKey,
            icon: GROUP_ICONS[groupKey] || "📦",
          };
        }
        nextGrouped[groupKey].tools.push(tool);
      } else {
        const dotIdx = tool.name.indexOf(".");
        const serverId = dotIdx !== -1 ? tool.name.substring(0, dotIdx) : "_unknown";
        const groupKey = `mcp_${serverId}`;
        if (!nextGrouped[groupKey]) {
          nextGrouped[groupKey] = {
            tools: [],
            label: serverNames[serverId] || serverId,
            icon: "🔗",
          };
        }
        nextGrouped[groupKey].tools.push(tool);
      }
    }

    return nextGrouped;
  }, [tools, serverNames]);

  const groupKeys = useMemo(() => {
    const keys = Object.keys(grouped);
    keys.sort((a, b) => {
      const aIdx = BUILTIN_ORDER.indexOf(a);
      const bIdx = BUILTIN_ORDER.indexOf(b);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.localeCompare(b);
    });
    return keys;
  }, [grouped]);

  const approvalCount = useMemo(() => policies.filter((p) => p.requires_approval).length, [policies]);
  const proactiveCount = useMemo(() => policies.filter((p) => p.is_proactive_enabled).length, [policies]);
  const userOnlyCount = useMemo(() => policies.filter((p) => p.scope === "user").length, [policies]);

  const setAllCollapsed = useCallback((value: boolean) => {
    const next: Record<string, boolean> = {};
    for (const groupKey of groupKeys) {
      next[groupKey] = value;
    }
    setCollapsed(next);
  }, [groupKeys]);

  async function togglePolicy(toolName: string, field: "requires_approval" | "is_proactive_enabled" | "scope", value: boolean | string) {
    const existing = policyMap.get(toolName);
    const nextPolicy: ToolPolicy = {
      tool_name: toolName,
      mcp_id: existing?.mcp_id || null,
      requires_approval: field === "requires_approval" ? (value ? 1 : 0) : existing?.requires_approval ?? 1,
      is_proactive_enabled: field === "is_proactive_enabled" ? (value ? 1 : 0) : existing?.is_proactive_enabled ?? 0,
      scope: field === "scope" ? (value as "global" | "user") : existing?.scope ?? "global",
    };

    setPolicies((prev) => {
      const idx = prev.findIndex((p) => p.tool_name === toolName);
      if (idx === -1) return [...prev, nextPolicy];
      const next = [...prev];
      next[idx] = nextPolicy;
      return next;
    });

    const resp = await fetch("/api/policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextPolicy),
    });

    if (!resp.ok) {
      fetchAll();
    }
  }

  async function toggleGroupPolicies(groupTools: ToolDef[], field: "requires_approval" | "is_proactive_enabled", value: boolean) {
    const updates = groupTools.map((tool) => {
      const existing = policyMap.get(tool.name);
      return {
        tool_name: tool.name,
        mcp_id: existing?.mcp_id || null,
        requires_approval: field === "requires_approval" ? (value ? 1 : 0) : existing?.requires_approval ?? 1,
        is_proactive_enabled: field === "is_proactive_enabled" ? (value ? 1 : 0) : existing?.is_proactive_enabled ?? 0,
        scope: existing?.scope ?? "global",
      } as ToolPolicy;
    });

    setPolicies((prev) => {
      const nextMap = new Map(prev.map((p) => [p.tool_name, p] as const));
      for (const update of updates) {
        nextMap.set(update.tool_name, update);
      }
      return Array.from(nextMap.values());
    });

    const responses = await Promise.all(
      updates.map((update) => {
        return fetch("/api/policies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(update),
        });
      })
    );

    if (responses.some((r) => !r.ok)) {
      fetchAll();
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground/70">
          Loading tool policies...
        </CardContent>
      </Card>
    );
  }

  if (tools.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <div className="text-3xl mb-3 opacity-30">🛡️</div>
          <p className="text-sm text-muted-foreground/60 font-light">
            No tools discovered yet. Connect an MCP server or wait for built-in tools to load.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs sm:text-sm text-muted-foreground">
          <span>{tools.length} tool{tools.length !== 1 ? "s" : ""} discovered</span>
          <span className="text-muted-foreground/30">•</span>
          <span>{groupKeys.length} group{groupKeys.length !== 1 ? "s" : ""}</span>
          <span className="text-muted-foreground/30">•</span>
          <span>{approvalCount} requiring approval</span>
          <span className="text-muted-foreground/30">•</span>
          <span>{proactiveCount} proactive</span>
          <span className="text-muted-foreground/30">•</span>
          <span>{userOnlyCount} user-only</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => setAllCollapsed(false)}
            className="text-primary/70 hover:text-primary transition-colors"
          >
            Expand all
          </button>
          <span className="text-muted-foreground/30">|</span>
          <button
            onClick={() => setAllCollapsed(true)}
            className="text-muted-foreground/70 hover:text-primary transition-colors"
          >
            Collapse all
          </button>
        </div>
      </div>

      {groupKeys.map((groupKey) => {
        const group = grouped[groupKey];
        const isCollapsed = collapsed[groupKey] ?? true;
        return (
          <Card key={groupKey}>
            <CardHeader className="pb-0 pt-4 px-4">
              <div className="flex items-start sm:items-center justify-between gap-2">
                <button
                  onClick={() => setCollapsed((prev) => ({ ...prev, [groupKey]: !isCollapsed }))}
                  className="flex items-center gap-2 text-left group min-w-0"
                >
                  <span className={`text-[10px] text-muted-foreground/40 transition-transform duration-200 ${isCollapsed ? "" : "rotate-90"}`}>▶</span>
                  <span className="text-sm mr-1">{group.icon}</span>
                  <CardTitle className="text-sm font-display font-semibold text-primary/90 group-hover:text-primary transition-colors truncate">
                    {group.label}
                    <span className="ml-2 text-[11px] font-normal text-muted-foreground/50">
                      {group.tools.length} tool{group.tools.length !== 1 ? "s" : ""}
                    </span>
                  </CardTitle>
                </button>
                {!isCollapsed && (
                  <div className="hidden sm:flex items-center gap-3 text-[10px] shrink-0">
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground/40 uppercase tracking-wider">Approval:</span>
                      <button onClick={() => toggleGroupPolicies(group.tools, "requires_approval", true)} className="text-primary/70 hover:text-primary transition-colors px-0.5">All</button>
                      <span className="text-muted-foreground/30">|</span>
                      <button onClick={() => toggleGroupPolicies(group.tools, "requires_approval", false)} className="text-muted-foreground/50 hover:text-primary transition-colors px-0.5">None</button>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-muted-foreground/40 uppercase tracking-wider">Proactive:</span>
                      <button onClick={() => toggleGroupPolicies(group.tools, "is_proactive_enabled", true)} className="text-primary/70 hover:text-primary transition-colors px-0.5">All</button>
                      <span className="text-muted-foreground/30">|</span>
                      <button onClick={() => toggleGroupPolicies(group.tools, "is_proactive_enabled", false)} className="text-muted-foreground/50 hover:text-primary transition-colors px-0.5">None</button>
                    </div>
                  </div>
                )}
              </div>
            </CardHeader>
            {!isCollapsed && (
              <CardContent className="p-0 pt-2">
                {isMobile ? (
                  <div className="px-3 pb-3 space-y-2">
                    <div className="flex items-center gap-3 text-[10px]">
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground/40 uppercase tracking-wider">Approval:</span>
                        <button onClick={() => toggleGroupPolicies(group.tools, "requires_approval", true)} className="text-primary/70 hover:text-primary transition-colors px-0.5">All</button>
                        <span className="text-muted-foreground/30">|</span>
                        <button onClick={() => toggleGroupPolicies(group.tools, "requires_approval", false)} className="text-muted-foreground/50 hover:text-primary transition-colors px-0.5">None</button>
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-muted-foreground/40 uppercase tracking-wider">Proactive:</span>
                        <button onClick={() => toggleGroupPolicies(group.tools, "is_proactive_enabled", true)} className="text-primary/70 hover:text-primary transition-colors px-0.5">All</button>
                        <span className="text-muted-foreground/30">|</span>
                        <button onClick={() => toggleGroupPolicies(group.tools, "is_proactive_enabled", false)} className="text-muted-foreground/50 hover:text-primary transition-colors px-0.5">None</button>
                      </div>
                    </div>

                    {group.tools.map((tool) => {
                      const policy = policyMap.get(tool.name);
                      const dotIdx = tool.name.indexOf(".");
                      const toolName = dotIdx !== -1 ? tool.name.substring(dotIdx + 1) : tool.name;
                      return (
                        <div key={tool.name} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 space-y-2">
                          <div className="text-xs font-mono text-primary/80 break-all">{toolName}</div>
                          <div className="text-xs text-muted-foreground/70 leading-relaxed break-words">{tool.description}</div>
                          <div className="flex items-center justify-between pt-1">
                            <div className="text-[11px] text-muted-foreground/70">Approval</div>
                            <Switch
                              checked={policy?.requires_approval !== 0}
                              onCheckedChange={(v) => togglePolicy(tool.name, "requires_approval", v)}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="text-[11px] text-muted-foreground/70">Proactive</div>
                            <Switch
                              checked={policy?.is_proactive_enabled === 1}
                              onCheckedChange={(v) => togglePolicy(tool.name, "is_proactive_enabled", v)}
                            />
                          </div>
                          <div className="flex items-center justify-between">
                            <div className="text-[11px] text-muted-foreground/70">Scope</div>
                            <button
                              onClick={() => togglePolicy(tool.name, "scope", policy?.scope === "global" ? "user" : "global")}
                              className={`text-[11px] font-medium px-2 py-0.5 rounded-full transition-colors ${
                                policy?.scope === "user"
                                  ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
                                  : "bg-white/[0.06] text-muted-foreground/60 hover:bg-white/[0.1]"
                              }`}
                            >
                              {policy?.scope === "user" ? "User Only" : "Global"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px]">
                      <thead>
                        <tr className="border-b border-white/[0.06] text-left text-[11px] text-muted-foreground/50 uppercase tracking-wider">
                          <th className="px-4 py-2 font-medium">Tool</th>
                          <th className="px-4 py-2 font-medium">Description</th>
                          <th className="px-4 py-2 text-center font-medium">Approval</th>
                          <th className="px-4 py-2 text-center font-medium">Proactive</th>
                          <th className="px-4 py-2 text-center font-medium">Scope</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.tools.map((tool) => {
                          const policy = policyMap.get(tool.name);
                          const dotIdx = tool.name.indexOf(".");
                          const toolName = dotIdx !== -1 ? tool.name.substring(dotIdx + 1) : tool.name;
                          return (
                            <tr key={tool.name} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors duration-200">
                              <td className="px-4 py-3 text-sm font-mono text-primary/80 max-w-[220px] break-all" title={toolName}>{toolName}</td>
                              <td className="px-4 py-3 text-sm text-muted-foreground/60 max-w-[360px]" title={tool.description}>
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
                              <td className="px-4 py-3 text-center">
                                <button
                                  onClick={() => togglePolicy(tool.name, "scope", policy?.scope === "global" ? "user" : "global")}
                                  className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors ${
                                    policy?.scope === "user"
                                      ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
                                      : "bg-white/[0.06] text-muted-foreground/60 hover:bg-white/[0.1]"
                                  }`}
                                >
                                  {policy?.scope === "user" ? "User Only" : "Global"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}