"use client";

import { useState, useEffect, useMemo } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import ClearIcon from "@mui/icons-material/Clear";
import EditIcon from "@mui/icons-material/Edit";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import SearchIcon from "@mui/icons-material/Search";
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

function getSourceColor(sourceType: "manual" | "chat" | "proactive"): "default" | "primary" | "secondary" {
  if (sourceType === "proactive") return "secondary";
  if (sourceType === "chat") return "primary";
  return "default";
}

export function KnowledgeVault() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [knowledgeTotal, setKnowledgeTotal] = useState(0);
  const [knowledgeHasMore, setKnowledgeHasMore] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [search, setSearch] = useState("");
  const [renderCount, setRenderCount] = useState(120);
  const { formatDate } = useTheme();

  const fetchKnowledge = () => {
    knowledgeService.list()
      .then((d) => {
        if (d && Array.isArray(d.data)) {
          setEntries(d.data);
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
          setEntries((prev) => [...prev, ...d.data]);
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
    let result = entries;
    if (sourceFilter === "proactive") {
      result = result.filter((e) => e.source_type === "proactive");
    } else if (sourceFilter === "manual") {
      result = result.filter((e) => e.source_type !== "proactive");
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (e) =>
          e.entity.toLowerCase().includes(q) ||
          e.attribute.toLowerCase().includes(q) ||
          e.value.toLowerCase().includes(q)
      );
    }
    return result;
  }, [entries, sourceFilter, search]);

  useEffect(() => {
    setRenderCount(120);
  }, [sourceFilter, search]);

  const visibleEntries = useMemo(() => filteredEntries.slice(0, renderCount), [filteredEntries, renderCount]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      <Box>
        <Typography variant="h5" sx={{ fontWeight: 700, color: "primary.main" }}>Knowledge Vault</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Nexus continuously captures durable facts from every chat turn. Review and curate them here.
        </Typography>
      </Box>

      {/* Toolbar */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
        <TextField
          size="small"
          placeholder="Search entity, attribute, or value…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          sx={{ flex: 1, minWidth: 200, maxWidth: 360 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: "1rem", color: "text.disabled" }} />
                </InputAdornment>
              ),
              endAdornment: search ? (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setSearch("")} edge="end">
                    <ClearIcon sx={{ fontSize: "0.9rem" }} />
                  </IconButton>
                </InputAdornment>
              ) : undefined,
            },
          }}
        />
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
        <Typography variant="caption" color="text.disabled" sx={{ ml: "auto" }}>
          {filteredEntries.length} / {knowledgeTotal} entries
        </Typography>
      </Box>

      {/* Table */}
      <Card variant="outlined" sx={{ overflow: "hidden" }}>
        <TableContainer sx={{ maxHeight: "calc(100vh - 320px)", overflowY: "auto", overflowX: "auto" }}>
          <Table size="small" stickyHeader sx={{ minWidth: 480 }}>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "text.disabled", py: 1 }}>Entity</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "text.disabled", py: 1, display: { xs: "none", sm: "table-cell" } }}>Attribute</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "text.disabled", py: 1 }}>Value</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "text.disabled", py: 1, display: { xs: "none", md: "table-cell" } }}>Source</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "text.disabled", py: 1, display: { xs: "none", md: "table-cell" } }}>Updated</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.06em", color: "text.disabled", py: 1, width: 72 }} align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visibleEntries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} align="center" sx={{ py: 6, color: "text.disabled" }}>
                    <Typography variant="body2" color="text.disabled">
                      {search
                        ? `No entries match "${search}"`
                        : sourceFilter === "all"
                        ? "No knowledge captured yet. Start chatting or connect proactive MCP sources."
                        : sourceFilter === "proactive"
                        ? "No proactive knowledge facts found yet."
                        : "No manual/chat knowledge facts found yet."}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                visibleEntries.map((entry) => (
                  <TableRow
                    key={entry.id}
                    hover
                    sx={{ "&:last-child td": { borderBottom: 0 } }}
                  >
                    <TableCell sx={{ fontSize: "0.82rem", fontWeight: 500, maxWidth: 140 }}>
                      <Typography noWrap variant="body2" sx={{ fontWeight: 500, fontSize: "inherit" }}>{entry.entity}</Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: "0.82rem", color: "text.secondary", maxWidth: 140, display: { xs: "none", sm: "table-cell" } }}>
                      <Typography noWrap variant="body2" sx={{ color: "inherit", fontSize: "inherit" }}>{entry.attribute}</Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: "0.82rem", maxWidth: 280 }}>
                      {editingId === entry.id ? (
                        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                          <TextField
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            size="small"
                            autoFocus
                            sx={{ flex: 1 }}
                          />
                          <Button size="small" variant="contained" onClick={() => updateEntry(entry.id)}>Save</Button>
                          <Button size="small" variant="text" onClick={() => setEditingId(null)}>Cancel</Button>
                        </Box>
                      ) : (
                        <Typography variant="body2" sx={{ fontSize: "inherit", wordBreak: "break-word" }}>{entry.value}</Typography>
                      )}
                    </TableCell>
                    <TableCell sx={{ display: { xs: "none", md: "table-cell" } }}>
                      <Chip
                        label={getSourceLabel(entry.source_type)}
                        size="small"
                        color={getSourceColor(entry.source_type)}
                        variant="outlined"
                        sx={{ height: 20, fontSize: "0.65rem" }}
                      />
                    </TableCell>
                    <TableCell sx={{ fontSize: "0.75rem", color: "text.disabled", whiteSpace: "nowrap", display: { xs: "none", md: "table-cell" } }}>
                      {formatDate(entry.last_updated, { year: "numeric", month: "short", day: "numeric" })}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                      <IconButton
                        size="small"
                        title="Edit"
                        onClick={() => { setEditingId(entry.id); setEditValue(entry.value); }}
                        sx={{ color: "text.secondary", "&:hover": { color: "primary.main" } }}
                      >
                        <EditIcon sx={{ fontSize: "0.95rem" }} />
                      </IconButton>
                      <IconButton
                        size="small"
                        title="Delete"
                        onClick={() => deleteEntry(entry.id)}
                        sx={{ color: "text.secondary", "&:hover": { color: "error.main" } }}
                      >
                        <DeleteOutlineIcon sx={{ fontSize: "0.95rem" }} />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Load more controls */}
        {filteredEntries.length > visibleEntries.length && (
          <Box sx={{ p: 1.5, display: "flex", justifyContent: "center", borderTop: 1, borderColor: "divider" }}>
            <Button
              size="small"
              variant="outlined"
              onClick={() => setRenderCount((prev) => prev + 120)}
            >
              Show more ({filteredEntries.length - visibleEntries.length} remaining)
            </Button>
          </Box>
        )}
        {knowledgeHasMore && filteredEntries.length <= visibleEntries.length && (
          <Box sx={{ p: 1.5, display: "flex", justifyContent: "center", borderTop: 1, borderColor: "divider" }}>
            <Button
              size="small"
              variant="outlined"
              onClick={loadMoreKnowledge}
            >
              Load more from server ({knowledgeTotal - entries.length} remaining)
            </Button>
          </Box>
        )}
      </Card>
    </Box>
  );
}
