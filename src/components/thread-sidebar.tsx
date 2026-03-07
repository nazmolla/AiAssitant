"use client";

import { memo } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import AddIcon from "@mui/icons-material/Add";
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
}: ThreadSidebarProps) {
  return (
    <Paper
      elevation={0}
      sx={{
        display: { xs: showSidebar ? "flex" : "none", sm: "flex" },
        width: { xs: "100%", sm: 260 },
        flexShrink: 0,
        flexDirection: "column",
        borderRight: 1,
        borderColor: "divider",
      }}
    >
      <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider" }}>
        <Button
          onClick={onCreateThread}
          fullWidth
          variant="outlined"
          size="small"
          startIcon={<AddIcon />}
        >
          New Thread
        </Button>
      </Box>
      <Box sx={{ flex: 1, overflow: "auto" }}>
        <List dense disablePadding sx={{ py: 0.5 }}>
          {threads.map((thread) => (
            <ListItemButton
              key={thread.id}
              selected={activeThread === thread.id}
              onClick={() => onSelectThread(thread.id)}
              sx={{
                mx: 0.5,
                borderRadius: 2,
                mb: 0.25,
                alignItems: "flex-start",
                pr: 1,
              }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>
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
                    sx={{ height: 20, fontSize: "0.7rem" }}
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
                  opacity: { xs: 1, sm: 0 },
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
        {threadsHasMore && (
          <Box sx={{ textAlign: "center", py: 1 }}>
            <Button size="small" onClick={onLoadMore}>
              Load more ({threadsTotal - threads.length} remaining)
            </Button>
          </Box>
        )}
      </Box>
    </Paper>
  );
});
