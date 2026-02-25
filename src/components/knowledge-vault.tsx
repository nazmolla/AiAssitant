"use client";

import { useState, useEffect } from "react";
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

export function KnowledgeVault() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const { formatDate } = useTheme();

  const fetchKnowledge = () => {
    fetch("/api/knowledge")
      .then((r) => r.json())
      .then(setEntries)
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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-display font-bold gradient-text">Knowledge Vault</h2>
        <p className="text-sm text-muted-foreground/60 mt-1 font-light">
          Nexus continuously captures durable facts from every chat turn. Review and curate them here.
        </p>
      </div>

      {/* Knowledge Table */}
      <Card>
        <CardContent className="p-0">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/[0.06] text-left text-[11px] text-muted-foreground/50 uppercase tracking-wider">
                <th className="p-4 font-medium">Entity</th>
                <th className="p-4 font-medium">Attribute</th>
                <th className="p-4 font-medium">Value</th>
                <th className="p-4 font-medium">Updated</th>
                <th className="p-4 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
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
              {entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-12 text-center">
                    <div className="text-3xl mb-3 opacity-30">🧠</div>
                    <p className="text-sm text-muted-foreground/60 font-light">
                      No knowledge captured yet. Start chatting or connect proactive MCP sources.
                    </p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
