"use client";

import { useState, useEffect, useRef, useCallback, memo } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Collapse from "@mui/material/Collapse";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import PsychologyIcon from "@mui/icons-material/Psychology";
import BuildIcon from "@mui/icons-material/Build";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import { useVirtualizer } from "@tanstack/react-virtual";
import MarkdownMessage from "./markdown-message";
import type { AttachmentMeta, ThinkingStep, ThoughtStep, ProcessedMessage } from "./chat-panel-types";
import { sanitizeToolContent, sanitizeAssistantContent } from "./chat-panel-types";

export interface ChatAreaProps {
  processedMessages: ProcessedMessage[];
  loading: boolean;
  thinkingSteps: ThinkingStep[];
  activeThread: string | null;
  activeThreadTitle: string | undefined;
  showSidebar: boolean;
  onBackToSidebar: () => void;
  playingTtsId: number | null;
  onPlayTts: (id: number, text: string) => void;
  actingApproval: string | null;
  resolvedApprovals: Record<string, string>;
  onApproval: (id: string, action: "approved" | "rejected") => void;
}

export const ChatArea = memo(function ChatArea({
  processedMessages,
  loading,
  thinkingSteps,
  activeThread,
  activeThreadTitle,
  showSidebar,
  onBackToSidebar,
  playingTtsId,
  onPlayTts,
  actingApproval,
  resolvedApprovals,
  onApproval,
}: ChatAreaProps) {
  // Reliability-first mode: avoid absolute-positioned rows to prevent
  // visual stacking/overlap when dynamic content shifts height after render.
  const useReliableRowLayout = true;

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual returns unstable function refs by design; memoization is not applicable here
  const virtualizer = useVirtualizer({
    count: processedMessages.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 120,
    overscan: 5,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const count = processedMessages.length;
    if (count > 0 && count !== prevCountRef.current) {
      prevCountRef.current = count;
      requestAnimationFrame(() => {
        if (useReliableRowLayout) {
          const scroller = scrollContainerRef.current;
          if (scroller) {
            scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
          }
          return;
        }
        // Use requestAnimationFrame to let the virtualizer render the new item first
        virtualizer.scrollToIndex(count - 1, { align: "end", behavior: "smooth" });
      });
    }
  }, [processedMessages.length, virtualizer, useReliableRowLayout]);

  // Re-measure all items when content changes (e.g., streaming tokens update content)
  const lastContentRef = useRef("");
  useEffect(() => {
    if (processedMessages.length === 0) return;
    const lastMsg = processedMessages[processedMessages.length - 1];
    const contentKey = lastMsg.msg.content || "";
    if (contentKey !== lastContentRef.current) {
      lastContentRef.current = contentKey;
      virtualizer.measure();
    }
  }, [processedMessages, virtualizer]);

  const measureRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) virtualizer.measureElement(node);
    },
    [virtualizer],
  );

  const scheduleMeasure = useCallback(() => {
    requestAnimationFrame(() => {
      virtualizer.measure();
      // Second frame catches late layout shifts (markdown/image cards/fonts).
      requestAnimationFrame(() => virtualizer.measure());
    });
  }, [virtualizer]);

  // Safety net: any message object update (including streamed token updates)
  // should trigger re-measure to prevent stale row offsets.
  useEffect(() => {
    scheduleMeasure();
  }, [processedMessages, scheduleMeasure]);

  // Dynamic UI blocks (thinking/thoughts/sidebar) can change row height without
  // changing message content; re-measure to keep virtual row offsets accurate.
  useEffect(() => {
    scheduleMeasure();
  }, [scheduleMeasure, thinkingSteps.length, loading, showSidebar]);

  // Re-measure when media-rich content (images/cards) finishes loading.
  // This prevents stale virtual offsets that can cause bubbles to overlap.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const onLoad = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName;
      if (tag === "IMG" || tag === "VIDEO" || tag === "IFRAME") {
        scheduleMeasure();
      }
    };

    container.addEventListener("load", onLoad, true);
    return () => container.removeEventListener("load", onLoad, true);
  }, [scheduleMeasure, processedMessages.length]);

  // Re-measure when the chat viewport width changes (e.g., responsive layout,
  // sidebar transitions), because text wrapping changes bubble heights.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(() => {
      scheduleMeasure();
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [scheduleMeasure]);

  // Web fonts can settle after first paint and change text wrapping/row heights.
  useEffect(() => {
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    if (!fonts?.ready) return;
    let cancelled = false;
    fonts.ready.then(() => {
      if (!cancelled) scheduleMeasure();
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [scheduleMeasure]);

  if (!activeThread) {
    return (
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative" }}>
        {/* Mobile back button for empty state */}
        <Box sx={{ display: { xs: "block", sm: "none" }, position: "absolute", top: 0, left: 0, px: 1.5, py: 1 }}>
          <Button
            size="small"
            variant="text"
            startIcon={<ArrowBackIcon />}
            onClick={onBackToSidebar}
            sx={{ textTransform: "none" }}
          >
            Threads
          </Button>
        </Box>
        <Box sx={{ textAlign: "center" }}>
          <ChatBubbleOutlineIcon sx={{ fontSize: 64, color: "text.disabled", mb: 2 }} />
          <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
            No thread selected
          </Typography>
          <Typography variant="caption" color="text.disabled">
            Select or create a thread to start chatting.
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <>
      {/* Mobile back button */}
      <Box sx={{ display: { xs: "flex", sm: "none" }, alignItems: "center", gap: 1, px: 1.5, py: 1, borderBottom: 1, borderColor: "divider" }}>
        <Button
          size="small"
          variant="text"
          startIcon={<ArrowBackIcon />}
          onClick={onBackToSidebar}
          sx={{ textTransform: "none" }}
        >
          Threads
        </Button>
        <Typography variant="caption" color="text.secondary" noWrap>{activeThreadTitle}</Typography>
      </Box>
      <Box ref={scrollContainerRef} sx={{ flex: 1, overflow: "auto", p: 2 }}>
        {(() => {
          const rowItems = useReliableRowLayout
            ? Array.from({ length: processedMessages.length }, (_, index) => ({
                index,
                start: 0,
                key: `reliable-${processedMessages[index].msg.id}-${index}`,
              }))
            : virtualizer.getVirtualItems();

          return (
        <Box
          sx={{
            maxWidth: 720,
            mx: "auto",
            position: "relative",
            height: useReliableRowLayout ? "auto" : virtualizer.getTotalSize(),
          }}
        >
          {rowItems.map((virtualItem) => {
            const pmIdx = virtualItem.index;
            const { msg, attachments, approvalMeta, displayContent, thoughts } = processedMessages[pmIdx];
            return (
            <Box
              key={virtualItem.key}
              ref={measureRef}
              data-index={virtualItem.index}
              sx={{
                position: useReliableRowLayout ? "relative" : "absolute",
                top: useReliableRowLayout ? "auto" : 0,
                left: useReliableRowLayout ? "auto" : 0,
                width: "100%",
                transform: useReliableRowLayout ? "none" : `translateY(${virtualItem.start}px)`,
                pb: 2,
              }}
            >
            <Box
              sx={{
                display: "flex",
                justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              <Paper
                elevation={msg.role === "user" ? 2 : 0}
                sx={{
                  maxWidth: "80%",
                  borderRadius: 3,
                  px: 2,
                  py: 1.5,
                  ...(msg.role === "user"
                    ? {
                        bgcolor: "primary.main",
                        color: "primary.contrastText",
                        borderBottomRightRadius: 4,
                      }
                    : msg.role === "system"
                    ? {
                        bgcolor: "warning.main",
                        color: "warning.contrastText",
                        opacity: 0.9,
                        borderBottomLeftRadius: 4,
                      }
                    : msg.role === "tool"
                    ? {
                        bgcolor: "action.hover",
                        fontFamily: "monospace",
                        fontSize: "0.75rem",
                        borderBottomLeftRadius: 4,
                      }
                    : {
                        bgcolor: "background.paper",
                        border: 1,
                        borderColor: "divider",
                        borderBottomLeftRadius: 4,
                      }),
                }}
              >
                {msg.role !== "user" && (
                  <Typography variant="overline" sx={{ fontSize: "0.625rem", letterSpacing: 1.2, color: msg.role === "system" ? "inherit" : "text.secondary" }}>
                    {msg.role === "assistant" ? "Nexus" : msg.role}
                  </Typography>
                )}

                {/* Agent Thinking Steps — shown on the last assistant message */}
                {msg.role === "assistant" && pmIdx === processedMessages.length - 1 && thinkingSteps.length > 0 && (
                  <ThinkingBlock steps={thinkingSteps} autoExpand={loading} onHeightChange={scheduleMeasure} />
                )}

                {/* Collapsible Thoughts */}
                {thoughts.length > 0 && <ThoughtsBlock thoughts={thoughts} autoExpand={loading} onHeightChange={scheduleMeasure} />}

                {/* Attachments */}
                {attachments.length > 0 && (
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 1 }}>
                    {attachments.map((att) => (
                      <AttachmentPreview key={att.id || att.filename} attachment={att} />
                    ))}
                  </Box>
                )}

                {/* Message content — assistant uses markdown, others plain text */}
                {msg.role === "assistant" ? (
                  msg.content ? (
                    <MarkdownMessage content={sanitizeAssistantContent(msg.content, attachments.length > 0)} />
                  ) : null
                ) : (
                  <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                    {msg.role === "tool"
                      ? sanitizeToolContent(msg.content, attachments.length > 0)
                      : msg.role === "system" && approvalMeta
                      ? displayContent || ""
                      : msg.content || (attachments.length > 0 ? "" : "(no content)")}
                  </Typography>
                )}
                {msg.id === -1 && loading && !msg.content && (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
                    <CircularProgress size={14} />
                    <Typography variant="caption" color="text.secondary" sx={{ fontStyle: "italic" }}>
                      Thinking...
                    </Typography>
                  </Box>
                )}

                {/* Timestamp */}
                {msg.created_at && (
                  <Typography
                    variant="caption"
                    sx={{
                      display: "block",
                      mt: 0.5,
                      fontSize: "0.6rem",
                      color: msg.role === "user" ? "rgba(255,255,255,0.7)" : "text.disabled",
                      textAlign: msg.role === "user" ? "right" : "left",
                    }}
                  >
                    {new Date(msg.created_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </Typography>
                )}

                {/* TTS — Read aloud button for assistant messages */}
                {msg.role === "assistant" && msg.content && msg.id !== -1 && (
                  <IconButton
                    size="small"
                    onClick={() => onPlayTts(msg.id, sanitizeAssistantContent(msg.content, false))}
                    title={playingTtsId === msg.id ? "Stop reading" : "Read aloud"}
                    sx={{ mt: 0.25, p: 0.5, opacity: 0.6, "&:hover": { opacity: 1 } }}
                  >
                    {playingTtsId === msg.id ? (
                      <StopCircleIcon sx={{ fontSize: 16 }} />
                    ) : (
                      <VolumeUpIcon sx={{ fontSize: 16 }} />
                    )}
                  </IconButton>
                )}

                {/* Inline approval buttons */}
                {approvalMeta && (() => {
                  const resolved = resolvedApprovals[approvalMeta.approvalId];
                  return (
                    <Box sx={{ mt: 1.5 }}>
                      <Box sx={{ fontSize: "0.7rem", color: "text.secondary", mb: 1 }}>
                        <div><strong>Tool:</strong> {approvalMeta.tool_name}</div>
                        {approvalMeta.reasoning && (
                          <div><strong>Reason:</strong> {approvalMeta.reasoning}</div>
                        )}
                        <details style={{ marginTop: 4 }}>
                          <summary style={{ cursor: "pointer", fontSize: "0.65rem" }}>Arguments</summary>
                          <Box component="pre" sx={{ fontSize: "0.65rem", bgcolor: "action.hover", p: 1, borderRadius: 1, mt: 0.5, overflow: "auto" }}>
                            {JSON.stringify(approvalMeta.args, null, 2)}
                          </Box>
                        </details>
                      </Box>
                      {resolved ? (
                        <Chip
                          label={resolved === "approved" ? "✓ Approved" : "✕ Denied"}
                          size="small"
                          color={resolved === "approved" ? "success" : "error"}
                        />
                      ) : (
                        <Box sx={{ display: "flex", gap: 1, pt: 0.5 }}>
                          <Button
                            variant="contained"
                            color="success"
                            size="small"
                            onClick={() => onApproval(approvalMeta.approvalId, "approved")}
                            disabled={actingApproval === approvalMeta.approvalId}
                          >
                            {actingApproval === approvalMeta.approvalId ? "Processing..." : "✓ Approve"}
                          </Button>
                          <Button
                            variant="outlined"
                            color="error"
                            size="small"
                            onClick={() => onApproval(approvalMeta.approvalId, "rejected")}
                            disabled={actingApproval === approvalMeta.approvalId}
                          >
                            ✕ Deny
                          </Button>
                        </Box>
                      )}
                    </Box>
                  );
                })()}
              </Paper>
            </Box>
            </Box>
            );
          })}
        </Box>
          );
        })()}
      </Box>
    </>
  );
});

/* -------------------------------------------------------------------------- */
/*  ThinkingBlock                                                              */
/* -------------------------------------------------------------------------- */

const ThinkingBlock = memo(function ThinkingBlock({ steps, autoExpand, onHeightChange }: { steps: ThinkingStep[]; autoExpand?: boolean; onHeightChange?: () => void }) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (autoExpand) setExpanded(true);
  }, [autoExpand]);

  useEffect(() => {
    onHeightChange?.();
  }, [onHeightChange, expanded, steps.length, autoExpand]);

  const stepCount = steps.length;

  return (
    <Box sx={{ mb: 1 }}>
      <Box
        onClick={() => setExpanded(!expanded)}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.5,
          cursor: "pointer",
          userSelect: "none",
          borderRadius: 2,
          px: 1,
          py: 0.5,
          bgcolor: "action.hover",
          "&:hover": { bgcolor: "action.selected" },
          transition: "background-color 0.15s",
        }}
      >
        <AutoAwesomeIcon sx={{ fontSize: 16, color: autoExpand ? "primary.main" : "text.secondary" }} />
        <Typography variant="caption" sx={{ fontWeight: 500, fontSize: "0.7rem", color: "text.secondary" }}>
          {autoExpand ? "Analyzing…" : `Analyzed in ${stepCount} ${stepCount === 1 ? "step" : "steps"}`}
        </Typography>
        {autoExpand && (
          <CircularProgress size={12} sx={{ ml: 0.5 }} />
        )}
        {expanded ? (
          <ExpandLessIcon sx={{ fontSize: 16, color: "text.secondary" }} />
        ) : (
          <ExpandMoreIcon sx={{ fontSize: 16, color: "text.secondary" }} />
        )}
      </Box>

      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <Box
          sx={{
            mt: 1,
            pl: 1.5,
            borderLeft: 2,
            borderColor: autoExpand ? "primary.main" : "divider",
            display: "flex",
            flexDirection: "column",
            gap: 0.75,
          }}
        >
          {steps.map((s, idx) => {
            const isLatest = autoExpand && idx === steps.length - 1;
            return (
              <Box key={`${s.step}-${idx}`} sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                {isLatest ? (
                  <CircularProgress size={12} sx={{ flexShrink: 0 }} />
                ) : (
                  <CheckCircleOutlineIcon sx={{ fontSize: 14, color: "success.main", flexShrink: 0 }} />
                )}
                <Box>
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 600,
                      fontSize: "0.7rem",
                      color: isLatest ? "text.primary" : "text.secondary",
                    }}
                  >
                    {s.step}
                  </Typography>
                  {s.detail && (
                    <Typography
                      variant="caption"
                      sx={{
                        fontSize: "0.65rem",
                        color: "text.disabled",
                        ml: 0.75,
                      }}
                    >
                      {s.detail}
                    </Typography>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Collapse>
    </Box>
  );
});

/* -------------------------------------------------------------------------- */
/*  ThoughtsBlock                                                              */
/* -------------------------------------------------------------------------- */

/** Pretty-print a tool name: "builtin.web_fetch" → "web_fetch", "mcp.server.tool" → "tool" */
function shortToolName(name: string): string {
  const parts = name.split(".");
  return parts[parts.length - 1];
}

const ThoughtsBlock = memo(function ThoughtsBlock({ thoughts, autoExpand, onHeightChange }: { thoughts: ThoughtStep[]; autoExpand?: boolean; onHeightChange?: () => void }) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (autoExpand) setExpanded(true);
  }, [autoExpand]);

  useEffect(() => {
    onHeightChange?.();
  }, [onHeightChange, expanded, thoughts.length, autoExpand]);

  const totalTools = thoughts.reduce((sum, t) => sum + t.toolCalls.length, 0);
  const toolNames = Array.from(new Set(thoughts.flatMap((t) => t.toolCalls.map((tc) => shortToolName(tc.name)))));
  const summaryLabel = totalTools === 1
    ? `Used ${toolNames[0]}`
    : `${totalTools} tool calls`;

  return (
    <Box sx={{ mb: 1 }}>
      <Box
        onClick={() => setExpanded(!expanded)}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.5,
          cursor: "pointer",
          userSelect: "none",
          borderRadius: 2,
          px: 1,
          py: 0.5,
          bgcolor: "action.hover",
          "&:hover": { bgcolor: "action.selected" },
          transition: "background-color 0.15s",
        }}
      >
        <PsychologyIcon sx={{ fontSize: 16, color: "text.secondary" }} />
        <Typography variant="caption" sx={{ fontWeight: 500, fontSize: "0.7rem", color: "text.secondary" }}>
          Thought for {thoughts.length} {thoughts.length === 1 ? "step" : "steps"}
        </Typography>
        <Chip
          label={summaryLabel}
          size="small"
          variant="outlined"
          icon={<BuildIcon sx={{ fontSize: "12px !important" }} />}
          sx={{ height: 20, fontSize: "0.65rem", ml: 0.5, "& .MuiChip-icon": { fontSize: 12 } }}
        />
        {expanded ? (
          <ExpandLessIcon sx={{ fontSize: 16, color: "text.secondary" }} />
        ) : (
          <ExpandMoreIcon sx={{ fontSize: 16, color: "text.secondary" }} />
        )}
      </Box>

      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <Box
          sx={{
            mt: 1,
            pl: 1.5,
            borderLeft: 2,
            borderColor: "divider",
            display: "flex",
            flexDirection: "column",
            gap: 1.5,
          }}
        >
          {thoughts.map((step, stepIdx) => (
            <Box key={stepIdx}>
              {step.thinking && (
                <Typography
                  variant="body2"
                  sx={{
                    fontSize: "0.8rem",
                    color: "text.secondary",
                    fontStyle: "italic",
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.5,
                    mb: 0.5,
                  }}
                >
                  {step.thinking}
                </Typography>
              )}

              {step.toolCalls.map((tc, tcIdx) => {
                const result = step.toolResults[tcIdx];
                return (
                  <Box key={tcIdx} sx={{ mb: 0.5 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.25 }}>
                      <BuildIcon sx={{ fontSize: 12, color: "text.disabled" }} />
                      <Typography
                        variant="caption"
                        sx={{ fontWeight: 600, fontFamily: "monospace", fontSize: "0.7rem", color: "text.secondary" }}
                      >
                        {shortToolName(tc.name)}
                      </Typography>
                    </Box>
                    <details style={{ marginLeft: 8 }}>
                      <summary style={{ cursor: "pointer", fontSize: "0.65rem", color: "inherit", opacity: 0.7 }}>
                        Arguments
                      </summary>
                      <Box
                        component="pre"
                        sx={{
                          fontSize: "0.65rem",
                          bgcolor: "action.hover",
                          p: 0.75,
                          borderRadius: 1,
                          mt: 0.25,
                          overflow: "auto",
                          maxHeight: 120,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {JSON.stringify(tc.args, null, 2)}
                      </Box>
                    </details>
                    {result && (
                      <details style={{ marginLeft: 8 }}>
                        <summary style={{ cursor: "pointer", fontSize: "0.65rem", color: "inherit", opacity: 0.7 }}>
                          Result
                        </summary>
                        <Box
                          component="pre"
                          sx={{
                            fontSize: "0.65rem",
                            bgcolor: "action.hover",
                            p: 0.75,
                            borderRadius: 1,
                            mt: 0.25,
                            overflow: "auto",
                            maxHeight: 200,
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                          }}
                        >
                          {result.result}
                        </Box>
                      </details>
                    )}

                    {step.attachments.length > 0 && tcIdx === step.toolCalls.length - 1 && (
                      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
                        {step.attachments.map((att) => (
                          <AttachmentPreview key={att.id || att.filename} attachment={att} />
                        ))}
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
});

/* -------------------------------------------------------------------------- */
/*  AttachmentPreview                                                          */
/* -------------------------------------------------------------------------- */

const AttachmentPreview = memo(function AttachmentPreview({ attachment }: { attachment: AttachmentMeta }) {
  const isImage = attachment.mimeType.startsWith("image/");
  const isVideo = attachment.mimeType.startsWith("video/");
  const url = attachment.storagePath
    ? `/api/attachments/${attachment.storagePath}`
    : undefined;

  if (isImage && url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        <Box
          component="img"
          src={url}
          alt={attachment.filename}
          sx={{ maxHeight: 400, maxWidth: "100%", borderRadius: 2, objectFit: "contain", cursor: "zoom-in", border: 1, borderColor: "divider", "&:hover": { borderColor: "primary.main" } }}
        />
      </a>
    );
  }

  if (isVideo && url) {
    return (
      <Box
        component="video"
        src={url}
        controls
        sx={{ maxHeight: 192, maxWidth: 320, borderRadius: 2, border: 1, borderColor: "divider" }}
      />
    );
  }

  return (
    <Chip
      component="a"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      clickable
      icon={<AttachFileIcon sx={{ fontSize: 14 }} />}
      label={`${attachment.filename} (${(attachment.sizeBytes / 1024).toFixed(0)} KB)`}
      size="small"
      variant="outlined"
    />
  );
});
