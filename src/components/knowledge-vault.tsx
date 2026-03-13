"use client";

import { useState, useEffect, useMemo } from "react";
import Box from "@mui/material/Box";
import MuiButton from "@mui/material/Button";
import MuiCard from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { useTheme } from "@/components/theme-provider";
import { knowledgeService } from "@/lib/api";

interface KnowledgeEntry {
  id: number;
  entity: string;
  attribute: string;
  value: string;
  source_type: "manual" | "chat" | "proactive";
  source_context: string | null;
  last_updated: string;
}

type SourceFilter = "all" | "proactive" | "manual";

function getSourceLabel(sourceType: "manual" | "chat" | "proactive"): string {
  if (sourceType === "proactive") return "Proactive";
  if (sourceType === "chat") return "Conversation";
  return "Manual";
}

export function KnowledgeVault() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [knowledgeTotal, setKnowledgeTotal] = useState(0);
  const [knowledgeHasMore, setKnowledgeHasMore] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [renderCount, setRenderCount] = useState(120);
  const [isMobile, setIsMobile] = useState(false);
  const { formatDate } = useTheme();

  const fetchKnowledge = () => {
    knowledgeService.list()
      .then((d) => {
        if (d && Array.isArray(d.data)) {
          setEntries(d.data as KnowledgeEntry[]);
          setKnowledgeTotal(d.total ?? d.data.length);
          setKnowledgeHasMore(d.hasMore ?? false);
        }
      })
      .catch(console.error);
  };

  const loadMoreKnowledge = () => {
    knowledgeService.list(100, entries.length)
      .then((d) => {
        if (d && Array.isArray(d.data)) {
          setEntries((prev) => [...prev, ...(d.data as KnowledgeEntry[])]);
          setKnowledgeTotal(d.total ?? entries.length + d.data.length);
          setKnowledgeHasMore(d.hasMore ?? false);
        }
      })
      .catch(console.error);
  };

  useEffect(() => {
    fetchKnowledge();
  }, []);

  async function updateEntry(id: number) {
    await knowledgeService.update(id, editValue);
    setEditingId(null);
    fetchKnowledge();
  }

  async function deleteEntry(id: number) {
    await knowledgeService.delete(id);
    fetchKnowledge();
  }

  const filteredEntries = useMemo(() => {
    if (sourceFilter === "all") return entries;
    if (sourceFilter === "proactive") {
      return entries.filter((entry) => entry.source_type === "proactive");
    }
    return entries.filter((entry) => entry.source_type !== "proactive");
  }, [entries, sourceFilter]);

  useEffect(() => {
    setRenderCount(120);
  }, [sourceFilter]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const visibleEntries = useMemo(() => filteredEntries.slice(0, renderCount), [filteredEntries, renderCount]);

  return (
    <div className="space-y-6">
      <div>
        <Typography variant="h5" sx={{ fontWeight: 700, color: "primary.main" }}>Knowledge Vault</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Nexus continuously captures durable facts from every chat turn. Review and curate them here.
        </Typography>
      </div>

      <ToggleButtonGroup
        value={sourceFilter}
        exclusive
        onChange={(_, v) => { if (v) setSourceFilter(v); }}
        size="small"
      >
        <ToggleButton value="all">All</ToggleButton>
        <ToggleButton value="proactive">Proactive</ToggleButton>
        <ToggleButton value="manual">Manual</ToggleButton>
      </ToggleButtonGroup>

      <MuiCard variant="outlined">
        <CardContent sx={{ p: 0 }}>
          {isMobile ? (
          <div className="p-3 space-y-2">
            {visibleEntries.map((entry) => (
              <div key={entry.id} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{entry.entity}</div>
                    <div className="text-xs text-muted-foreground/70 truncate">{entry.attribute}</div>
                  </div>
                  <div className="text-[10px] text-muted-foreground/60 shrink-0">{getSourceLabel(entry.source_type)}</div>
                </div>
                {editingId === entry.id ? (
                  <div className="space-y-2">
                    <TextField
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      size="small"
                    />
                    <div className="flex gap-2">
                      <MuiButton size="small" variant="contained" onClick={() => updateEntry(entry.id)}>Save</MuiButton>
                      <MuiButton size="small" variant="text" onClick={() => setEditingId(null)}>Cancel</MuiButton>
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
                    <MuiButton
                      size="small"
                      variant="text"
                      onClick={() => {
                        setEditingId(entry.id);
                        setEditValue(entry.value);
                      }}
                    >
                      Edit
                    </MuiButton>
                    <MuiButton size="small" variant="text" color="error" onClick={() => deleteEntry(entry.id)}>
                      Delete
                    </MuiButton>
                  </div>
                </div>
              </div>
            ))}
          </div>
          ) : (

          <div className="overflow-x-auto">
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
                          <TextField
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            size="small"
                          />
                          <MuiButton size="small" variant="contained" onClick={() => updateEntry(entry.id)}>
                            Save
                          </MuiButton>
                          <MuiButton
                            size="small"
                            variant="text"
                            onClick={() => setEditingId(null)}
                          >
                            Cancel
                          </MuiButton>
                        </div>
                      ) : (
                        entry.value
                      )}
                    </td>
                    <td className="p-4 text-xs text-muted-foreground/70">
                      {getSourceLabel(entry.source_type)}
                    </td>
                    <td className="p-4 text-xs text-muted-foreground/50">
                      {formatDate(entry.last_updated, { year: "numeric", month: "short", day: "numeric" })}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex justify-end gap-1">
                        <MuiButton
                          size="small"
                          variant="text"
                          onClick={() => {
                            setEditingId(entry.id);
                            setEditValue(entry.value);
                          }}
                        >
                          Edit
                        </MuiButton>
                        <MuiButton
                          size="small"
                          variant="text"
                          color="error"
                          onClick={() => deleteEntry(entry.id)}
                        >
                          Delete
                        </MuiButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}

          {filteredEntries.length === 0 && (
            <Box sx={{ p: 6, textAlign: "center" }}>
              <Typography sx={{ fontSize: "2rem", mb: 1, opacity: 0.3 }}>🧠</Typography>
              <Typography variant="body2" color="text.secondary">
                {sourceFilter === "all"
                  ? "No knowledge captured yet. Start chatting or connect proactive MCP sources."
                  : sourceFilter === "proactive"
                    ? "No proactive knowledge facts found yet."
                    : "No manual/chat knowledge facts found yet."}
              </Typography>
            </Box>
          )}

          {filteredEntries.length > visibleEntries.length && (
            <Box sx={{ p: 1.5, display: "flex", justifyContent: "center" }}>
              <MuiButton
                size="small"
                variant="outlined"
                onClick={() => setRenderCount((prev) => prev + 120)}
              >
                Load more ({filteredEntries.length - visibleEntries.length} remaining)
              </MuiButton>
            </Box>
          )}
          {knowledgeHasMore && filteredEntries.length <= visibleEntries.length && (
            <Box sx={{ p: 1.5, display: "flex", justifyContent: "center" }}>
              <MuiButton
                size="small"
                variant="outlined"
                onClick={loadMoreKnowledge}
              >
                Load more from server ({knowledgeTotal - entries.length} remaining)
              </MuiButton>
            </Box>
          )}
        </CardContent>
      </MuiCard>
    </div>
  );
}
