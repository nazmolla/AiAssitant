"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

interface CustomTool {
  name: string;
  description: string;
  input_schema: string;
  implementation: string;
  enabled: number;
  created_at: string;
}

export function CustomToolsConfig() {
  const [tools, setTools] = useState<CustomTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedTool, setExpandedTool] = useState<string | null>(null);

  const fetchTools = async () => {
    try {
      const res = await fetch("/api/config/custom-tools");
      if (!res.ok) throw new Error("Failed to load custom tools");
      const data = await res.json();
      setTools(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTools();
  }, []);

  const handleToggle = async (name: string, enabled: boolean) => {
    try {
      const res = await fetch("/api/config/custom-tools", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, enabled }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(data.error);
      }
      await fetchTools();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleDelete = async (name: string) => {
    const confirmed = window.confirm(`Delete custom tool "${name}"? This cannot be undone.`);
    if (!confirmed) return;

    try {
      const res = await fetch("/api/config/custom-tools", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(data.error);
      }
      setExpandedTool(null);
      await fetchTools();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const parseSchema = (raw: string): Record<string, unknown> => {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-sm text-muted-foreground/60 font-light">Loading custom tools...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Explainer Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display">Self-Extending Tools</CardTitle>
          <CardDescription className="text-muted-foreground/60">
            Nexus can create its own tools at runtime. When the agent determines it needs a capability
            that doesn&apos;t exist yet, it uses <code className="text-[11px] bg-white/5 px-1.5 py-0.5 rounded">nexus_create_tool</code> to
            build and register a new tool — subject to your approval. Tools run in a sandboxed environment
            with no file system or process access.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Tools List */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-display font-semibold">Agent-Created Tools</h3>
          <span className="text-sm text-muted-foreground/50 font-light">
            {tools.length === 0 ? "No tools yet" : `${tools.length} tool${tools.length !== 1 ? "s" : ""}`}
          </span>
        </div>

        {error && (
          <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-2">{error}</p>
        )}

        {tools.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <div className="text-3xl mb-3 opacity-30">🔧</div>
              <p className="text-sm text-muted-foreground/60 font-light">
                No custom tools created yet. The agent will create tools as needed during conversations.
              </p>
              <p className="text-[11px] text-muted-foreground/40 mt-2 font-light">
                Tool creation always requires your approval via the Approval Inbox.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {tools.map((tool) => {
              const schema = parseSchema(tool.input_schema);
              const properties = (schema.properties || {}) as Record<string, { type?: string; description?: string }>;
              const paramNames = Object.keys(properties);
              const isExpanded = expandedTool === tool.name;

              return (
                <div
                  key={tool.name}
                  className={cn(
                    "rounded-xl border p-4 transition-all duration-300",
                    tool.enabled
                      ? "border-white/[0.08] hover:bg-white/[0.02]"
                      : "border-white/[0.04] bg-white/[0.01] opacity-60"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setExpandedTool(isExpanded ? null : tool.name)}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="text-sm font-medium font-mono">{tool.name}</code>
                        <Badge variant={tool.enabled ? "success" : "secondary"} className="text-[10px]">
                          {tool.enabled ? "Active" : "Disabled"}
                        </Badge>
                        {paramNames.length > 0 && (
                          <span className="text-[10px] text-muted-foreground/40">
                            {paramNames.length} param{paramNames.length !== 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      <p className="text-[12px] text-muted-foreground/60 mt-1 line-clamp-2">
                        {tool.description}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 ml-3 shrink-0">
                      <Switch
                        checked={!!tool.enabled}
                        onCheckedChange={(checked) => handleToggle(tool.name, checked)}
                      />
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDelete(tool.name)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="mt-4 space-y-3 border-t border-white/[0.06] pt-4">
                      {/* Parameters */}
                      {paramNames.length > 0 && (
                        <div>
                          <h4 className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider mb-2">
                            Parameters
                          </h4>
                          <div className="space-y-1.5">
                            {paramNames.map((pName) => (
                              <div key={pName} className="flex items-start gap-2 text-[12px]">
                                <code className="text-primary/80 font-mono shrink-0">{pName}</code>
                                <span className="text-muted-foreground/40">
                                  ({properties[pName]?.type || "any"})
                                </span>
                                {properties[pName]?.description && (
                                  <span className="text-muted-foreground/50">
                                    — {properties[pName].description}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Implementation */}
                      <div>
                        <h4 className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider mb-2">
                          Implementation
                        </h4>
                        <pre className="text-[11px] bg-black/30 border border-white/[0.06] rounded-lg p-3 overflow-x-auto max-h-64 overflow-y-auto font-mono text-muted-foreground/70">
                          {tool.implementation}
                        </pre>
                      </div>

                      <p className="text-[10px] text-muted-foreground/30">
                        Created: {new Date(tool.created_at).toLocaleString()}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
