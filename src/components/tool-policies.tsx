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

export function ToolPolicies() {
  const [tools, setTools] = useState<ToolDef[]>([]);
  const [policies, setPolicies] = useState<ToolPolicy[]>([]);

  const fetchAll = useCallback(() => {
    fetch("/api/mcp/tools").then((r) => r.json()).then(setTools).catch(console.error);
    fetch("/api/policies").then((r) => r.json()).then(setPolicies).catch(console.error);
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>{tools.length} tool{tools.length !== 1 ? "s" : ""} discovered</span>
        <span className="text-muted-foreground/30">•</span>
        <span>{policies.filter((p) => p.requires_approval).length} requiring approval</span>
        <span className="text-muted-foreground/30">•</span>
        <span>{policies.filter((p) => p.is_proactive_enabled).length} proactive</span>
      </div>

      <Card>
        <CardContent className="p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-[11px] text-muted-foreground/50 uppercase tracking-wider">
                <th className="p-4 font-medium">Tool</th>
                <th className="p-4 font-medium">Description</th>
                <th className="p-4 text-center font-medium">
                  <div>Requires Approval</div>
                  <div className="flex items-center justify-center gap-1 mt-1">
                    <button onClick={() => toggleAllPolicies("requires_approval", true)} className="text-[10px] text-primary/70 hover:text-primary transition-colors px-1">All</button>
                    <span className="text-[10px] text-muted-foreground/30">|</span>
                    <button onClick={() => toggleAllPolicies("requires_approval", false)} className="text-[10px] text-muted-foreground/50 hover:text-primary transition-colors px-1">None</button>
                  </div>
                </th>
                <th className="p-4 text-center font-medium">
                  <div>Proactive Enabled</div>
                  <div className="flex items-center justify-center gap-1 mt-1">
                    <button onClick={() => toggleAllPolicies("is_proactive_enabled", true)} className="text-[10px] text-primary/70 hover:text-primary transition-colors px-1">All</button>
                    <span className="text-[10px] text-muted-foreground/30">|</span>
                    <button onClick={() => toggleAllPolicies("is_proactive_enabled", false)} className="text-[10px] text-muted-foreground/50 hover:text-primary transition-colors px-1">None</button>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {tools.map((tool) => {
                const policy = policies.find((p) => p.tool_name === tool.name);
                return (
                  <tr key={tool.name} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors duration-200">
                    <td className="p-4 text-sm font-mono text-primary/80">{tool.name}</td>
                    <td className="p-4 text-sm text-muted-foreground/60">
                      {tool.description.substring(0, 80)}
                      {tool.description.length > 80 ? "..." : ""}
                    </td>
                    <td className="p-4 text-center">
                      <Switch
                        checked={policy?.requires_approval !== 0}
                        onCheckedChange={(v) => togglePolicy(tool.name, "requires_approval", v)}
                      />
                    </td>
                    <td className="p-4 text-center">
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
      </Card>
    </div>
  );
}
