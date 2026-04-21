"use client";

import { memo } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import Divider from "@mui/material/Divider";
import Tooltip from "@mui/material/Tooltip";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import type { Thread } from "./chat-panel-types";

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(isoString).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export interface ThreadSidebarProps {
  threads: Thread[];
  threadsTotal: number;
  threadsHasMore: boolean;
  activeThread: string | null;
  showSidebar: boolean;
  onSelectThread: (id: string) => void;
  onCreateThread: () => void;
  onDeleteThread: (id: string) => void;
  onLoadMore: () => void;
  onClose: () => void;
  /** App-level navigation items shown at the bottom of the drawer */
  navItems?: { value: string; label: string; icon: React.ReactElement }[];
  activeNavTab?: string;
  onNavigate?: (tab: string) => void;
}

export const ThreadSidebar = memo(function ThreadSidebar({
  threads,
  threadsTotal,
  threadsHasMore,
  activeThread,
  showSidebar,
  onSelectThread,
  onCreateThread,
  onDeleteThread,
  onLoadMore,
  onClose,
  navItems,
  activeNavTab,
  onNavigate,
}: ThreadSidebarProps) {
  return (
    <Drawer
      open={showSidebar}
      onClose={onClose}
      anchor="left"
      PaperProps={{
        sx: {
          width: 280,
          display: "flex",
          flexDirection: "column",
          background: "var(--glass-bg-strong)",
          backdropFilter: "blur(var(--blur)) saturate(1.6)",
          WebkitBackdropFilter: "blur(var(--blur)) saturate(1.6)",
          borderRight: "1px solid var(--glass-border)",
          boxShadow: "var(--shadow-glass)",
        },
      }}
    >
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", px: 2, py: 1.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1, color: "var(--ng-fg)", fontSize: "0.85rem", letterSpacing: "0.06em", textTransform: "uppercase" }}>
          Conversations
        </Typography>
        <IconButton size="small" onClick={onClose} sx={{ color: "var(--ng-fg-dim)", "&:hover": { color: "var(--ng-fg)", background: "rgba(255,255,255,0.06)" }, borderRadius: "10px" }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      <Divider sx={{ borderColor: "var(--glass-border)" }} />

      {/* New thread button */}
      <Box sx={{ px: 1.5, py: 1.25 }}>
        <Button
          onClick={() => { onCreateThread(); onClose(); }}
          fullWidth
          size="small"
          startIcon={<AddIcon />}
          sx={{
            borderRadius: "10px",
            justifyContent: "flex-start",
            textTransform: "none",
            fontSize: "0.8rem",
            fontWeight: 500,
            color: "var(--ng-fg)",
            background: "rgba(255,255,255,0.06)",
            border: "1px solid var(--glass-border)",
            "&:hover": { background: "rgba(255,255,255,0.10)", borderColor: "var(--glass-border-strong)" },
          }}
        >
          New conversation
        </Button>
      </Box>

      <Divider sx={{ borderColor: "var(--glass-border)" }} />

      {/* Thread list */}
      <Box sx={{ flex: 1, overflow: "auto", "&::-webkit-scrollbar": { width: 6 }, "&::-webkit-scrollbar-thumb": { background: "rgba(255,255,255,0.08)", borderRadius: 4 } }}>
        {threads.length === 0 ? (
          <Box sx={{ px: 2, py: 3, textAlign: "center" }}>
            <Typography variant="caption" sx={{ color: "var(--ng-fg-mute)" }}>
              No conversations yet
            </Typography>
          </Box>
        ) : (
          <List dense disablePadding sx={{ py: 0.5 }}>
            {threads.map((thread) => (
              <ListItemButton
                key={thread.id}
                selected={activeThread === thread.id}
                onClick={() => onSelectThread(thread.id)}
                sx={{
                  mx: 0.75,
                  borderRadius: "10px",
                  mb: 0.25,
                  alignItems: "flex-start",
                  pr: 0.5,
                  color: "var(--ng-fg-dim)",
                  "&:hover": { background: "rgba(255,255,255,0.06)", color: "var(--ng-fg)" },
                  "&.Mui-selected": {
                    background: "rgba(91,140,255,0.12)",
                    color: "var(--ng-fg)",
                    "&:hover": { background: "rgba(91,140,255,0.16)" },
                  },
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 500, fontSize: "0.825rem", color: "inherit" }}>
                    {thread.title}
                  </Typography>
                  <Box sx={{ mt: 0.5, display: "flex", alignItems: "center", gap: 0.75 }}>
                    <Chip
                      label={thread.status}
                      size="small"
                      color={
                        thread.status === "active"
                          ? "success"
                          : thread.status === "awaiting_approval"
                          ? "warning"
                          : "default"
                      }
                      sx={{ height: 16, fontSize: "0.6rem" }}
                    />
                    {thread.last_message_at && (
                      <Typography variant="caption" sx={{ fontSize: "0.6rem", color: "var(--ng-fg-mute)" }}>
                        {formatRelativeTime(thread.last_message_at)}
                      </Typography>
                    )}
                  </Box>
                </Box>
                <Tooltip title="Delete conversation" placement="right">
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteThread(thread.id);
                    }}
                    sx={{
                      mt: 0.5,
                      color: "var(--ng-fg-mute)",
                      borderRadius: "8px",
                      "&:hover": { color: "var(--ng-err)", background: "rgba(248,113,113,0.1)" },
                    }}
                  >
                    <DeleteOutlineIcon sx={{ fontSize: "0.9rem" }} />
                  </IconButton>
                </Tooltip>
              </ListItemButton>
            ))}
          </List>
        )}
        {threadsHasMore && (
          <Box sx={{ textAlign: "center", py: 1 }}>
            <Button size="small" onClick={onLoadMore} sx={{ textTransform: "none", fontSize: "0.75rem", color: "var(--ng-fg-dim)", "&:hover": { color: "var(--ng-fg)" } }}>
              Load more ({threadsTotal - threads.length} remaining)
            </Button>
          </Box>
        )}
      </Box>

      {/* App navigation section at the bottom */}
      {navItems && navItems.length > 0 && onNavigate && (
        <>
          <Divider sx={{ borderColor: "var(--glass-border)" }} />
          <Box sx={{ px: 0.5, py: 0.5 }}>
            <List dense disablePadding>
              {navItems.map((item) => (
                <ListItemButton
                  key={item.value}
                  selected={activeNavTab === item.value}
                  onClick={() => { onNavigate(item.value); onClose(); }}
                  sx={{
                    borderRadius: "10px",
                    minHeight: 36,
                    py: 0.5,
                    px: 1.5,
                    mb: 0.25,
                    color: "var(--ng-fg-dim)",
                    "&:hover": { background: "rgba(255,255,255,0.06)", color: "var(--ng-fg)" },
                    "&.Mui-selected": {
                      background: "rgba(91,140,255,0.12)",
                      color: "var(--ng-fg)",
                      "& .MuiListItemIcon-root": { color: "var(--ng-accent)" },
                      "&:hover": { background: "rgba(91,140,255,0.16)" },
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 28, color: "inherit" }}>{item.icon}</ListItemIcon>
                  <ListItemText
                    primary={item.label}
                    primaryTypographyProps={{ fontSize: "0.8rem", fontWeight: 500 }}
                  />
                </ListItemButton>
              ))}
            </List>
          </Box>
        </>
      )}
    </Drawer>
  );
});
