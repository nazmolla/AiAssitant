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
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import type { Thread } from "./chat-panel-types";

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
          bgcolor: "background.default",
        },
      }}
    >
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", px: 2, py: 1.5 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>
          Conversations
        </Typography>
        <IconButton size="small" onClick={onClose} sx={{ color: "text.secondary" }}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      <Divider />

      {/* New thread button */}
      <Box sx={{ px: 1.5, py: 1.25 }}>
        <Button
          onClick={() => { onCreateThread(); onClose(); }}
          fullWidth
          variant="outlined"
          size="small"
          startIcon={<AddIcon />}
          sx={{ borderRadius: 2, justifyContent: "flex-start", textTransform: "none" }}
        >
          New conversation
        </Button>
      </Box>

      <Divider />

      {/* Thread list */}
      <Box sx={{ flex: 1, overflow: "auto" }}>
        {threads.length === 0 ? (
          <Box sx={{ px: 2, py: 3, textAlign: "center" }}>
            <Typography variant="caption" color="text.disabled">
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
                  borderRadius: 2,
                  mb: 0.25,
                  alignItems: "flex-start",
                  pr: 0.5,
                }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" noWrap sx={{ fontWeight: 500, fontSize: "0.875rem" }}>
                    {thread.title}
                  </Typography>
                  <Box sx={{ mt: 0.5 }}>
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
                      sx={{ height: 18, fontSize: "0.65rem" }}
                    />
                  </Box>
                </Box>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteThread(thread.id);
                  }}
                  sx={{
                    mt: 0.5,
                    opacity: 0,
                    ".MuiListItemButton-root:hover &": { opacity: 1 },
                    color: "text.secondary",
                    "&:hover": { color: "error.main" },
                  }}
                >
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </ListItemButton>
            ))}
          </List>
        )}
        {threadsHasMore && (
          <Box sx={{ textAlign: "center", py: 1 }}>
            <Button size="small" onClick={onLoadMore} sx={{ textTransform: "none", fontSize: "0.75rem" }}>
              Load more ({threadsTotal - threads.length} remaining)
            </Button>
          </Box>
        )}
      </Box>

      {/* App navigation section at the bottom */}
      {navItems && navItems.length > 0 && onNavigate && (
        <>
          <Divider />
          <Box sx={{ px: 0.5, py: 0.5 }}>
            <List dense disablePadding>
              {navItems.map((item) => (
                <ListItemButton
                  key={item.value}
                  selected={activeNavTab === item.value}
                  onClick={() => { onNavigate(item.value); onClose(); }}
                  sx={{
                    borderRadius: 1.5,
                    minHeight: 36,
                    py: 0.5,
                    px: 1.5,
                    mb: 0.25,
                    "&.Mui-selected": {
                      bgcolor: "primary.main",
                      color: "primary.contrastText",
                      "& .MuiListItemIcon-root": { color: "inherit" },
                      "&:hover": { bgcolor: "primary.dark" },
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 28, color: "text.secondary" }}>{item.icon}</ListItemIcon>
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
