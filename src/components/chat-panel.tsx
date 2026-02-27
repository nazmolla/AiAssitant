"use client";

import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Divider from "@mui/material/Divider";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import CircularProgress from "@mui/material/CircularProgress";
import SendIcon from "@mui/icons-material/Send";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import ScreenShareIcon from "@mui/icons-material/ScreenShare";
import StopScreenShareIcon from "@mui/icons-material/StopScreenShare";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";

interface Thread {
  id: string;
  title: string;
  status: string;
  last_message_at: string;
}

interface AttachmentMeta {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storagePath: string;
}

interface Message {
  id: number;
  thread_id: string;
  role: string;
  content: string | null;
  tool_calls: string | null;
  tool_results: string | null;
  attachments: string | null;
}

interface PendingFile {
  file: File;
  previewUrl: string | null;
  uploading: boolean;
  uploaded?: AttachmentMeta;
}

const ALLOWED_EXTENSIONS = [
  ".jpg", ".jpeg", ".jfif", ".png", ".gif", ".webp", ".svg", ".heic", ".heif", ".avif", ".bmp", ".tif", ".tiff", ".dng", ".raw",
  ".pdf", ".txt", ".csv", ".md", ".json", ".doc", ".docx", ".xls", ".xlsx",
  ".mp4", ".webm", ".mov",
];

const ACCEPT_STRING = ALLOWED_EXTENSIONS.join(",");

/** Sanitize tool message content: hide raw screenshot paths when attachments are present */
function sanitizeToolContent(content: string | null, hasAttachments: boolean): string {
  if (!content) return hasAttachments ? "" : "(no content)";
  // If the tool message contains screenshot paths and we have inline attachments, hide the raw JSON
  if (hasAttachments && (content.includes('"screenshotPath"') || content.includes('"relativePath"'))) {
    return "";
  }
  // Even without attachments, clean up raw screenshot result JSON so users never see paths
  if (content.includes('"screenshotPath"') || content.includes('"relativePath"')) {
    return "📸 Screenshot captured.";
  }
  return content;
}

/** Extract approval metadata from a system message, if any */
function extractApprovalMeta(content: string | null): { approvalId: string; tool_name: string; args: Record<string, unknown>; reasoning: string | null } | null {
  if (!content) return null;
  const match = content.match(/<!-- APPROVAL:(\{[\s\S]*?\}) -->/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

/** Strip approval metadata marker from display text */
function stripApprovalMeta(content: string | null): string {
  if (!content) return "";
  return content.replace(/\n?<!-- APPROVAL:\{[\s\S]*?\} -->/,"").trim();
}

/** Strip sandbox/file paths from assistant messages so users see clean text */
function sanitizeAssistantContent(content: string | null, hasAttachments: boolean): string {
  if (!content) return hasAttachments ? "" : "(no content)";
  let cleaned = content;
  // Remove markdown links with sandbox: or absolute file paths
  cleaned = cleaned.replace(/\[([^\]]*?)\]\(sandbox:[^)]*\)/g, "");
  cleaned = cleaned.replace(/\[([^\]]*?)\]\(\/home\/[^)]*\)/g, "");
  cleaned = cleaned.replace(/\[([^\]]*?)\]\(\/[a-zA-Z][^)]*\.png[^)]*\)/g, "");
  // Remove raw sandbox: paths
  cleaned = cleaned.replace(/sandbox:\/[^\s)]+/g, "");
  // Remove raw absolute file paths to screenshots
  cleaned = cleaned.replace(/\/home\/[^\s)]*screenshots\/[^\s)]+/g, "");
  cleaned = cleaned.replace(/\/home\/[^\s)]*\.png/g, "");
  // Remove leftover "You can view it" type phrases that referenced removed links
  cleaned = cleaned.replace(/You can view (?:it|the screenshot)\s*\.?\s*/gi, "");
  cleaned = cleaned.replace(/Here(?:'s| is) the screenshot\s*\.?/gi, (m) => m); // keep this one
  // Collapse extra whitespace/newlines
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  // If the assistant only had a path link and nothing else, show a clean fallback
  if (!cleaned && hasAttachments) return "";
  if (!cleaned) return "(no content)";
  return cleaned;
}

export function ChatPanel() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [screenShareEnabled, setScreenShareEnabled] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [actingApproval, setActingApproval] = useState<string | null>(null);
  const [resolvedApprovals, setResolvedApprovals] = useState<Record<string, string>>({});
  const [showSidebar, setShowSidebar] = useState(true);

  // Screen sharing state
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [screenSharing, setScreenSharing] = useState(false);
  const latestFrameRef = useRef<string | null>(null);
  const frameImgRef = useRef<HTMLImageElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Capture a single frame from the screen share video stream */
  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return null;

    canvas.width = Math.min(video.videoWidth, 1920);
    canvas.height = Math.round((canvas.width / video.videoWidth) * video.videoHeight);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.7);
  }, []);

  /** Start screen sharing */
  async function startScreenShare() {
    // Check if getDisplayMedia is available (requires HTTPS or localhost)
    if (!navigator.mediaDevices?.getDisplayMedia) {
      alert(
        "Screen sharing is not available.\n\n" +
        "This feature requires a secure context (HTTPS or localhost).\n" +
        "If you're accessing via HTTP over a network, enable HTTPS or use localhost."
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { max: 1 } },
        audio: false,
      });

      // Create hidden video element for the stream
      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      videoRef.current = video;

      // Create hidden canvas for frame capture
      if (!canvasRef.current) {
        canvasRef.current = document.createElement("canvas");
      }

      setScreenStream(stream);
      setScreenSharing(true);

      // Capture preview frame immediately
      setTimeout(() => {
        const frame = captureFrame();
        if (frame) {
          latestFrameRef.current = frame;
          if (frameImgRef.current) frameImgRef.current.src = frame;
        }
      }, 500);

      // Update preview every 5 seconds via ref (no React re-render)
      frameIntervalRef.current = setInterval(() => {
        const frame = captureFrame();
        if (frame) {
          latestFrameRef.current = frame;
          if (frameImgRef.current) frameImgRef.current.src = frame;
        }
      }, 5000);

      // Handle user stopping share via browser UI
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        stopScreenShare();
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        // User cancelled the dialog — not an error
        return;
      }
      console.error("Screen share failed:", err);
      alert("Screen sharing failed: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  /** Stop screen sharing */
  function stopScreenShare() {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current = null;
    }
    setScreenStream(null);
    setScreenSharing(false);
    latestFrameRef.current = null;
  }

  // Clean up screen share on unmount
  useEffect(() => {
    return () => {
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
      if (screenStream) screenStream.getTracks().forEach((t) => t.stop());
    };
  }, [screenStream]);

  // Fetch screen sharing preference (and re-fetch periodically to pick up settings changes)
  useEffect(() => {
    function fetchScreenSharePref() {
      fetch("/api/config/profile")
        .then((r) => r.json())
        .then((p) => {
          if (p && p.screen_sharing_enabled !== undefined) {
            setScreenShareEnabled(p.screen_sharing_enabled === 1);
          }
        })
        .catch(() => {});
    }
    fetchScreenSharePref();
    // Re-check when tab becomes visible (user may have changed settings)
    function onVisChange() {
      if (document.visibilityState === "visible") fetchScreenSharePref();
    }
    document.addEventListener("visibilitychange", onVisChange);
    return () => document.removeEventListener("visibilitychange", onVisChange);
  }, []);

  // Fetch threads
  useEffect(() => {
    fetch("/api/threads")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setThreads(d); })
      .catch(console.error);
  }, []);

  // Fetch messages when thread changes
  useEffect(() => {
    if (!activeThread) return;
    fetch(`/api/threads/${activeThread}`)
      .then((r) => r.json())
      .then((data) => setMessages(data.messages || []))
      .catch(console.error);
  }, [activeThread]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Listen for approval-resolved events to refresh messages and threads
  useEffect(() => {
    function handleApprovalResolved() {
      // Refresh messages in the active thread
      if (activeThread) {
        fetch(`/api/threads/${activeThread}`)
          .then((r) => r.json())
          .then((data) => setMessages(data.messages || []))
          .catch(console.error);
      }
      // Refresh thread list (status may have changed)
      fetch("/api/threads")
        .then((r) => r.json())
        .then((d) => { if (Array.isArray(d)) setThreads(d); })
        .catch(console.error);
    }
    window.addEventListener("approval-resolved", handleApprovalResolved);
    return () => window.removeEventListener("approval-resolved", handleApprovalResolved);
  }, [activeThread]);

  async function createThread() {
    const res = await fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New Thread" }),
    });
    const thread = await res.json();
    setThreads((prev) => [thread, ...prev]);
    setActiveThread(thread.id);
    setMessages([]);
    setPendingFiles([]);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;

    const newPending: PendingFile[] = Array.from(files).map((file) => ({
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      uploading: false,
    }));
    setPendingFiles((prev) => [...prev, ...newPending]);
    // Reset input so same file can be re-selected
    e.target.value = "";
  }

  function removePendingFile(index: number) {
    setPendingFiles((prev) => {
      const copy = [...prev];
      if (copy[index].previewUrl) URL.revokeObjectURL(copy[index].previewUrl!);
      copy.splice(index, 1);
      return copy;
    });
  }

  async function uploadFile(file: File, threadId: string): Promise<AttachmentMeta> {
    const form = new FormData();
    form.append("file", file);
    form.append("threadId", threadId);
    const res = await fetch("/api/attachments", { method: "POST", body: form });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "Upload failed");
    }
    return res.json();
  }

  async function handleDeleteThread(threadId: string) {
    if (!confirm("Delete this thread and all its messages?")) return;
    try {
      const res = await fetch(`/api/threads/${threadId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        console.error(err.error);
        return;
      }
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
      if (activeThread === threadId) {
        setActiveThread(null);
        setMessages([]);
      }
    } catch (err) {
      console.error("Failed to delete thread:", err);
    }
  }

  async function handleApproval(approvalId: string, action: "approved" | "rejected") {
    setActingApproval(approvalId);
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId, action }),
      });
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || `Failed to ${action === "approved" ? "approve" : "deny"} (HTTP ${res.status})`);
        return;
      }

      // Mark this approval as resolved in local state (hides buttons immediately)
      setResolvedApprovals((prev) => ({ ...prev, [approvalId]: data.alreadyResolved ? data.status : action }));

      // Show continuation errors if the agent loop failed after tool execution
      if (data.continuationError) {
        console.warn("Agent continuation error:", data.continuationError);
      }

      // Refresh messages and threads — the agent loop may have added new messages
      if (activeThread) {
        const threadRes = await fetch(`/api/threads/${activeThread}`);
        const threadData = await threadRes.json();
        setMessages(threadData.messages || []);
      }
      fetch("/api/threads").then((r) => r.json()).then((d) => { if (Array.isArray(d)) setThreads(d); }).catch(console.error);

      // Notify other components (approval inbox, dashboard)
      window.dispatchEvent(new CustomEvent("approval-resolved", { detail: data }));
    } catch (err) {
      console.error("Approval action failed:", err);
      alert(`Approval action failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActingApproval(null);
    }
  }

  async function sendMessage() {
    if ((!input.trim() && pendingFiles.length === 0 && !screenSharing) || !activeThread) return;

    const userMsg = input;
    const filesToSend = [...pendingFiles];
    setInput("");
    setPendingFiles([]);
    setLoading(true);

    // Capture screen frame if sharing is active
    const frames: string[] = [];
    if (screenSharing) {
      const frame = captureFrame();
      if (frame) frames.push(frame);
    }

    // Optimistic update
    const optimisticAttachments = filesToSend.map((pf) => ({
      id: "",
      filename: pf.file.name,
      mimeType: pf.file.type,
      sizeBytes: pf.file.size,
      storagePath: "",
    }));
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
        thread_id: activeThread,
        role: "user",
        content: userMsg || null,
        tool_calls: null,
        tool_results: null,
        attachments: optimisticAttachments.length > 0 ? JSON.stringify(optimisticAttachments) : null,
      },
    ]);

    try {
      // Upload files first
      const uploadedMeta: AttachmentMeta[] = [];
      for (const pf of filesToSend) {
        const meta = await uploadFile(pf.file, activeThread);
        uploadedMeta.push(meta);
        if (pf.previewUrl) URL.revokeObjectURL(pf.previewUrl);
      }

      const res = await fetch(`/api/threads/${activeThread}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: userMsg || (frames.length > 0 ? "(see my screen)" : undefined),
          attachments: uploadedMeta.length > 0 ? uploadedMeta : undefined,
          screenFrames: frames.length > 0 ? frames : undefined,
        }),
      });
      const data = await res.json();

      if (data.error) {
        setMessages((prev) => [
          ...prev,
          { id: Date.now() + 1, thread_id: activeThread, role: "system", content: `Error: ${data.error}`, tool_calls: null, tool_results: null, attachments: null },
        ]);
      } else {
        // Refresh messages from server
        const threadRes = await fetch(`/api/threads/${activeThread}`);
        const threadData = await threadRes.json();
        setMessages(threadData.messages || []);
        // Refresh thread list to pick up auto-generated title
        fetch("/api/threads").then((r) => r.json()).then((d) => { if (Array.isArray(d)) setThreads(d); }).catch(console.error);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, thread_id: activeThread, role: "system", content: `Error: ${err}`, tool_calls: null, tool_results: null, attachments: null },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const activeThreadTitle = useMemo(() => threads.find(t => t.id === activeThread)?.title, [threads, activeThread]);

  // Pre-process messages: parse attachments once, compute display data
  const processedMessages = useMemo(() => {
    return messages
      .filter((msg) => {
        if (msg.role === "tool") return false;
        if (msg.role === "assistant") {
          const parsedAtt: AttachmentMeta[] = msg.attachments ? JSON.parse(msg.attachments) : [];
          const hasAtt = parsedAtt.length > 0;
          const content = sanitizeAssistantContent(msg.content, hasAtt);
          if (!content || content === "(no content)") return hasAtt;
        }
        return true;
      })
      .map((msg) => {
        const attachments: AttachmentMeta[] = msg.attachments ? JSON.parse(msg.attachments) : [];
        const approvalMeta = msg.role === "system" ? extractApprovalMeta(msg.content) : null;
        const displayContent = approvalMeta ? stripApprovalMeta(msg.content) : msg.content;
        return { msg, attachments, approvalMeta, displayContent };
      });
  }, [messages]);

  return (
    <Box sx={{ display: "flex", height: "100%" }}>
      {/* Thread Sidebar */}
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
            onClick={createThread}
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
                onClick={() => { setActiveThread(thread.id); setShowSidebar(false); }}
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
                    handleDeleteThread(thread.id);
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
        </Box>
      </Paper>

      {/* Chat Area */}
      <Box
        sx={{
          display: { xs: !showSidebar ? "flex" : "none", sm: "flex" },
          flex: 1,
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        {activeThread ? (
          <>
            {/* Mobile back button */}
            <Box sx={{ display: { xs: "flex", sm: "none" }, alignItems: "center", gap: 1, px: 1.5, py: 1, borderBottom: 1, borderColor: "divider" }}>
              <Button
                size="small"
                variant="text"
                startIcon={<ArrowBackIcon />}
                onClick={() => setShowSidebar(true)}
                sx={{ textTransform: "none" }}
              >
                Threads
              </Button>
              <Typography variant="caption" color="text.secondary" noWrap>{activeThreadTitle}</Typography>
            </Box>
            <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
              <Box sx={{ maxWidth: 720, mx: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
                {processedMessages.map(({ msg, attachments, approvalMeta, displayContent }) => {

                  return (
                    <Box
                      key={msg.id}
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

                        {/* Attachments */}
                        {attachments.length > 0 && (
                          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mb: 1 }}>
                            {attachments.map((att) => (
                              <AttachmentPreview key={att.id || att.filename} attachment={att} />
                            ))}
                          </Box>
                        )}

                        <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                          {msg.role === "tool"
                            ? sanitizeToolContent(msg.content, attachments.length > 0)
                            : msg.role === "assistant"
                            ? sanitizeAssistantContent(msg.content, attachments.length > 0)
                            : msg.role === "system" && approvalMeta
                            ? displayContent || ""
                            : msg.content || (attachments.length > 0 ? "" : "(no content)")}
                        </Typography>

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
                                    onClick={() => handleApproval(approvalMeta.approvalId, "approved")}
                                    disabled={actingApproval === approvalMeta.approvalId}
                                  >
                                    {actingApproval === approvalMeta.approvalId ? "Processing..." : "✓ Approve"}
                                  </Button>
                                  <Button
                                    variant="outlined"
                                    color="error"
                                    size="small"
                                    onClick={() => handleApproval(approvalMeta.approvalId, "rejected")}
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
                  );
                })}
                <div ref={messagesEndRef} />
              </Box>
            </Box>

            {/* Input Bar */}
            <Box sx={{ borderTop: 1, borderColor: "divider", p: 1.5, bgcolor: "background.paper" }}>
              <Box sx={{ maxWidth: 720, mx: "auto" }}>
                {/* Screen sharing indicator */}
                {screenSharing && (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, px: 1.5, py: 1, borderRadius: 2, bgcolor: "error.main", color: "error.contrastText", opacity: 0.9 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "white", animation: "pulse 1.5s infinite" }} />
                    <Typography variant="caption" sx={{ fontWeight: 500 }}>Sharing your screen</Typography>
                    <img
                      ref={frameImgRef}
                      alt="Screen preview"
                      style={{ height: 32, borderRadius: 4, marginLeft: "auto", display: latestFrameRef.current ? undefined : "none" }}
                    />
                    <Button
                      size="small"
                      variant="text"
                      onClick={stopScreenShare}
                      sx={{ color: "inherit", minWidth: 0 }}
                    >
                      Stop
                    </Button>
                  </Box>
                )}

                {/* Pending file previews */}
                {pendingFiles.length > 0 && (
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1 }}>
                    {pendingFiles.map((pf, idx) => (
                      <Chip
                        key={`${pf.file.name}-${pf.file.lastModified}`}
                        label={pf.file.name}
                        size="small"
                        variant="outlined"
                        icon={pf.previewUrl ? (
                          <img
                            src={pf.previewUrl}
                            alt={pf.file.name}
                            style={{ height: 20, width: 20, objectFit: "cover", borderRadius: 4 }}
                          />
                        ) : undefined}
                        onDelete={() => removePendingFile(idx)}
                        sx={{ maxWidth: 180 }}
                      />
                    ))}
                  </Box>
                )}

                <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={ACCEPT_STRING}
                    onChange={handleFileSelect}
                    style={{ display: "none" }}
                  />
                  <IconButton
                    size="small"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading || !activeThread}
                    title="Attach files"
                  >
                    <AttachFileIcon fontSize="small" />
                  </IconButton>
                  {screenShareEnabled && (
                    <IconButton
                      size="small"
                      onClick={screenSharing ? stopScreenShare : startScreenShare}
                      disabled={loading || !activeThread}
                      title={screenSharing ? "Stop screen sharing" : "Share your screen"}
                      color={screenSharing ? "error" : "default"}
                    >
                      {screenSharing ? <StopScreenShareIcon fontSize="small" /> : <ScreenShareIcon fontSize="small" />}
                    </IconButton>
                  )}
                  <TextField
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                    placeholder="Message Nexus..."
                    disabled={loading}
                    size="small"
                    fullWidth
                    variant="outlined"
                  />
                  <IconButton
                    onClick={sendMessage}
                    disabled={loading || (!input.trim() && pendingFiles.length === 0 && !screenSharing)}
                    color="primary"
                    title="Send message"
                  >
                    {loading ? (
                      <CircularProgress size={20} color="inherit" />
                    ) : (
                      <SendIcon fontSize="small" />
                    )}
                  </IconButton>
                </Box>
              </Box>
            </Box>
          </>
        ) : (
          <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative" }}>
            {/* Mobile back button for empty state */}
            <Box sx={{ display: { xs: "block", sm: "none" }, position: "absolute", top: 0, left: 0, px: 1.5, py: 1 }}>
              <Button
                size="small"
                variant="text"
                startIcon={<ArrowBackIcon />}
                onClick={() => setShowSidebar(true)}
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
        )}
      </Box>
    </Box>
  );
}

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
