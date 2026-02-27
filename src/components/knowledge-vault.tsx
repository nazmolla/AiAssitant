"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTheme } from "@/components/theme-provider";

interface KnowledgeEntry {
  id: number;
  entity: string;
  attribute: string;
  value: string;
  source_context: string | null;
  last_updated: string;
}

type SourceFilter = "all" | "proactive" | "manual";

function getSourceLabel(sourceContext: string | null): string {
  if (!sourceContext) return "Manual";
  if (sourceContext.startsWith("mcp:")) {
    if (sourceContext.endsWith(":poll")) return "Proactive Poll";
    if (sourceContext.endsWith(":assessment")) return "Proactive Assessment";
    return "Proactive";
  }
  return "Manual";
}

export function KnowledgeVault() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [renderCount, setRenderCount] = useState(120);
  const { formatDate } = useTheme();

  const fetchKnowledge = () => {
    fetch("/api/knowledge")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setEntries(d); })
      .catch(console.error);
  };

  useEffect(() => {
    fetchKnowledge();
  }, []);

  async function updateEntry(id: number) {
    await fetch("/api/knowledge", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, value: editValue }),
    });
    setEditingId(null);
    fetchKnowledge();
  }

  async function deleteEntry(id: number) {
    await fetch(`/api/knowledge?id=${id}`, { method: "DELETE" });
    fetchKnowledge();
  }

  const filteredEntries = useMemo(() => {
    if (sourceFilter === "all") return entries;
    if (sourceFilter === "proactive") {
      return entries.filter((entry) => (entry.source_context || "").startsWith("mcp:"));
    }
    return entries.filter((entry) => !(entry.source_context || "").startsWith("mcp:"));
  }, [entries, sourceFilter]);

  useEffect(() => {
    setRenderCount(120);
  }, [sourceFilter]);

  const visibleEntries = useMemo(() => filteredEntries.slice(0, renderCount), [filteredEntries, renderCount]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-display font-bold gradient-text">Knowledge Vault</h2>
        <p className="text-sm text-muted-foreground/60 mt-1 font-light">
          Nexus continuously captures durable facts from every chat turn. Review and curate them here.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={sourceFilter === "all" ? "default" : "outline"}
          onClick={() => setSourceFilter("all")}
        >
          All
        </Button>
        <Button
          size="sm"
          variant={sourceFilter === "proactive" ? "default" : "outline"}
          onClick={() => setSourceFilter("proactive")}
        >
          Proactive
        </Button>
        <Button
          size="sm"
          variant={sourceFilter === "manual" ? "default" : "outline"}
          onClick={() => setSourceFilter("manual")}
        >
          Manual
        </Button>
      </div>

      {/* Knowledge Table */}
      <Card>
        <CardContent className="p-0">
          <div className="md:hidden p-3 space-y-2">
            {visibleEntries.map((entry) => (
              <div key={entry.id} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{entry.entity}</div>
                    <div className="text-xs text-muted-foreground/70 truncate">{entry.attribute}</div>
                  </div>
                  <div className="text-[10px] text-muted-foreground/60 shrink-0">{getSourceLabel(entry.source_context)}</div>
                </div>
                {editingId === entry.id ? (
                  <div className="space-y-2">
                    <Input
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="h-8"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => updateEntry(entry.id)}>Save</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-foreground/80 break-words">{entry.value}</div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] text-muted-foreground/60">
                    {formatDate(entry.last_updated, { year: "numeric", month: "short", day: "numeric" })}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingId(entry.id);
                        setEditValue(entry.value);
                      }}
                    >
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteEntry(entry.id)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="hidden md:block overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="border-b border-white/[0.06] text-left text-[11px] text-muted-foreground/50 uppercase tracking-wider">
                  <th className="p-4 font-medium">Entity</th>
                  <th className="p-4 font-medium">Attribute</th>
                  <th className="p-4 font-medium">Value</th>
                  <th className="p-4 font-medium">Source</th>
                  <th className="p-4 font-medium">Updated</th>
                  <th className="p-4 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleEntries.map((entry) => (
                  <tr key={entry.id} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors duration-200">
                    <td className="p-4 text-sm font-medium">{entry.entity}</td>
                    <td className="p-4 text-sm text-foreground/80">{entry.attribute}</td>
                    <td className="p-4 text-sm">
                      {editingId === entry.id ? (
                        <div className="flex gap-1">
                          <Input
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="h-8"
                          />
                          <Button size="sm" onClick={() => updateEntry(entry.id)}>
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        entry.value
                      )}
                    </td>
                    <td className="p-4 text-xs text-muted-foreground/70">
                      {getSourceLabel(entry.source_context)}
                    </td>
                    <td className="p-4 text-xs text-muted-foreground/50">
                      {formatDate(entry.last_updated, { year: "numeric", month: "short", day: "numeric" })}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingId(entry.id);
                            setEditValue(entry.value);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => deleteEntry(entry.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredEntries.length === 0 && (
            <div className="p-12 text-center">
              <div className="text-3xl mb-3 opacity-30">🧠</div>
              <p className="text-sm text-muted-foreground/60 font-light">
                {sourceFilter === "all"
                  ? "No knowledge captured yet. Start chatting or connect proactive MCP sources."
                  : sourceFilter === "proactive"
                    ? "No proactive knowledge facts found yet."
                    : "No manual/chat knowledge facts found yet."}
              </p>
            </div>
          )}

          {filteredEntries.length > visibleEntries.length && (
            <div className="p-3 flex justify-center">
              <button
                onClick={() => setRenderCount((prev) => prev + 120)}
                className="text-xs px-3 py-1.5 rounded-lg border border-white/[0.08] text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors"
              >
                Load more ({filteredEntries.length - visibleEntries.length} remaining)
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
