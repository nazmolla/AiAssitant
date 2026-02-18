"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";

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
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg",
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch threads
  useEffect(() => {
    fetch("/api/threads")
      .then((r) => r.json())
      .then(setThreads)
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
        .then(setThreads)
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

  async function sendMessage() {
    if ((!input.trim() && pendingFiles.length === 0) || !activeThread) return;

    const userMsg = input;
    const filesToSend = [...pendingFiles];
    setInput("");
    setPendingFiles([]);
    setLoading(true);

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
          message: userMsg || undefined,
          attachments: uploadedMeta.length > 0 ? uploadedMeta : undefined,
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
        fetch("/api/threads").then((r) => r.json()).then(setThreads).catch(console.error);
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

  return (
    <div className="flex h-full">
      {/* Thread Sidebar — Glass panel */}
      <div className="w-64 border-r border-white/[0.06] flex flex-col bg-white/[0.02] backdrop-blur-md">
        <div className="p-3 border-b border-white/[0.06]">
          <Button onClick={createThread} className="w-full rounded-xl" size="sm" variant="outline">
            <span className="mr-1.5 text-primary">+</span> New Thread
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="py-2 px-2 space-y-0.5">
            {threads.map((thread) => (
              <div
                key={thread.id}
                className={`relative group flex items-start rounded-xl transition-all duration-300 ${
                  activeThread === thread.id
                    ? "bg-primary/10 border border-primary/15 shadow-sm shadow-primary/5"
                    : "hover:bg-white/[0.04] border border-transparent"
                }`}
              >
                <button
                  onClick={() => setActiveThread(thread.id)}
                  className="flex-1 text-left px-3 py-2.5"
                >
                  <div className="text-[13px] font-medium truncate pr-5">{thread.title}</div>
                  <div className="flex items-center gap-1 mt-1.5">
                    <Badge
                      variant={
                        thread.status === "active"
                          ? "success"
                          : thread.status === "awaiting_approval"
                          ? "warning"
                          : "secondary"
                      }
                    >
                      {thread.status}
                    </Badge>
                  </div>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteThread(thread.id);
                  }}
                  className="absolute right-2 top-2.5 opacity-0 group-hover:opacity-100 transition-all duration-200 p-1 rounded-lg hover:bg-red-500/10 text-muted-foreground/60 hover:text-red-400 text-xs"
                  title="Delete thread"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {activeThread ? (
          <>
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4 max-w-3xl mx-auto">
                {messages.map((msg) => {
                  const attachments: AttachmentMeta[] = msg.attachments
                    ? JSON.parse(msg.attachments)
                    : [];

                  return (
                    <div
                      key={msg.id}
                      className={`flex ${
                        msg.role === "user" ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-3 transition-all duration-200 ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground rounded-br-lg shadow-md shadow-primary/20"
                            : msg.role === "system"
                            ? "bg-orange-500/5 border border-orange-500/15 rounded-bl-lg backdrop-blur-sm"
                            : msg.role === "tool"
                            ? "bg-white/[0.03] border border-white/[0.06] font-mono text-xs rounded-bl-lg backdrop-blur-sm"
                            : "bg-gradient-to-b from-white/[0.06] to-white/[0.02] border border-white/[0.08] rounded-bl-lg shadow-lg shadow-black/20 backdrop-blur-md"
                        }`}
                      >
                        {msg.role !== "user" && (
                          <div className="text-[10px] font-medium mb-1 text-muted-foreground uppercase tracking-wider">
                            {msg.role === "assistant" ? "Nexus" : msg.role}
                          </div>
                        )}

                        {/* Attachments */}
                        {attachments.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-2">
                            {attachments.map((att) => (
                              <AttachmentPreview key={att.id || att.filename} attachment={att} />
                            ))}
                          </div>
                        )}

                        <div className="whitespace-pre-wrap text-[13px] leading-relaxed">
                          {msg.role === "tool"
                            ? sanitizeToolContent(msg.content, attachments.length > 0)
                            : msg.role === "assistant"
                            ? sanitizeAssistantContent(msg.content, attachments.length > 0)
                            : msg.content || (attachments.length > 0 ? "" : "(no content)")}
                        </div>
                        {msg.tool_calls && (
                          <details className="mt-2">
                            <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground transition-colors">
                              Tool calls
                            </summary>
                            <div className="text-[10px] mt-1 text-muted-foreground font-mono">
                              {msg.tool_calls}
                            </div>
                          </details>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Input Bar — Floating glass panel */}
            <div className="border-t border-white/[0.06] p-3 bg-white/[0.02] backdrop-blur-xl">
              <div className="max-w-3xl mx-auto">
                {/* Pending file previews */}
                {pendingFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {pendingFiles.map((pf, idx) => (
                      <div
                        key={idx}
                        className="relative group flex items-center gap-1.5 bg-white/[0.04] rounded-xl px-2.5 py-1.5 text-xs border border-white/[0.08]"
                      >
                        {pf.previewUrl ? (
                          <img
                            src={pf.previewUrl}
                            alt={pf.file.name}
                            className="h-7 w-7 object-cover rounded-md"
                          />
                        ) : (
                          <span className="text-sm">📄</span>
                        )}
                        <span className="max-w-[100px] truncate text-[11px]">{pf.file.name}</span>
                        <button
                          onClick={() => removePendingFile(idx)}
                          className="ml-0.5 text-muted-foreground hover:text-red-500 transition-colors"
                          title="Remove"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 items-center">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={ACCEPT_STRING}
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading || !activeThread}
                    title="Attach files"
                    className="shrink-0 h-9 w-9 rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/5"
                  >
                    📎
                  </Button>
                  <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                    placeholder="Message Nexus..."
                    disabled={loading}
                    className="rounded-xl bg-white/[0.03] border-white/[0.08] focus-visible:border-primary/30"
                  />
                  <Button
                    onClick={sendMessage}
                    disabled={loading || (!input.trim() && pendingFiles.length === 0)}
                    size="icon"
                    className="shrink-0 h-9 w-9 rounded-xl shadow-md shadow-primary/20"
                  >
                    {loading ? (
                      <span className="h-4 w-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M2 8L14 2L8 14L7 9L2 8Z" fill="currentColor" />
                      </svg>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-4 relative">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-64 h-64 bg-primary/3 rounded-full blur-3xl" />
            </div>
            <div className="relative z-10 flex flex-col items-center gap-4">
              <div className="text-5xl opacity-60">💬</div>
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-foreground/60">No thread selected</p>
                <p className="text-xs text-muted-foreground/60 font-light">Select or create a thread to start chatting.</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AttachmentPreview({ attachment }: { attachment: AttachmentMeta }) {
  const isImage = attachment.mimeType.startsWith("image/");
  const isVideo = attachment.mimeType.startsWith("video/");
  const url = attachment.storagePath
    ? `/api/attachments/${attachment.storagePath}`
    : undefined;

  if (isImage && url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer">
        <img
          src={url}
          alt={attachment.filename}
          className="max-h-[400px] max-w-full rounded-xl object-contain cursor-zoom-in ring-1 ring-white/[0.08] hover:ring-primary/30 transition-all duration-300"
        />
      </a>
    );
  }

  if (isVideo && url) {
    return (
      <video
        src={url}
        controls
        className="max-h-48 max-w-xs rounded-xl ring-1 ring-white/[0.08]"
      />
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 bg-white/[0.04] rounded-xl px-3 py-2 text-xs border border-white/[0.08] hover:bg-white/[0.06] hover:border-primary/20 transition-all duration-300"
    >
      <span className="text-sm">📄</span>
      <span className="max-w-[140px] truncate text-[11px]">{attachment.filename}</span>
      <span className="text-[10px] text-muted-foreground/60">
        {(attachment.sizeBytes / 1024).toFixed(0)} KB
      </span>
    </a>
  );
}
