"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
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
      {/* Thread Sidebar */}
      <div className="w-64 border-r flex flex-col">
        <div className="p-3 border-b">
          <Button onClick={createThread} className="w-full" size="sm">
            + New Thread
          </Button>
        </div>
        <ScrollArea className="flex-1">
          {threads.map((thread) => (
            <div
              key={thread.id}
              className={`relative group flex items-start border-b hover:bg-muted transition-colors ${
                activeThread === thread.id ? "bg-muted" : ""
              }`}
            >
              <button
                onClick={() => setActiveThread(thread.id)}
                className="flex-1 text-left px-3 py-2 text-sm"
              >
                <div className="font-medium truncate pr-6">{thread.title}</div>
                <div className="flex items-center gap-1 mt-1">
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
                className="absolute right-1 top-1.5 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive hover:text-destructive-foreground text-muted-foreground text-xs"
                title="Delete thread"
              >
                ✕
              </button>
            </div>
          ))}
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
                      <Card
                        className={`max-w-[80%] p-3 ${
                          msg.role === "user"
                            ? "bg-primary text-primary-foreground"
                            : msg.role === "system"
                            ? "bg-muted border-yellow-500/50"
                            : msg.role === "tool"
                            ? "bg-muted border-blue-500/50 font-mono text-xs"
                            : "bg-card"
                        }`}
                      >
                        <div className="text-xs font-medium mb-1 opacity-70 uppercase">
                          {msg.role}
                        </div>

                        {/* Attachments */}
                        {attachments.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-2">
                            {attachments.map((att) => (
                              <AttachmentPreview key={att.id || att.filename} attachment={att} />
                            ))}
                          </div>
                        )}

                        <div className="whitespace-pre-wrap text-sm">
                          {msg.role === "tool"
                            ? sanitizeToolContent(msg.content, attachments.length > 0)
                            : msg.role === "assistant"
                            ? sanitizeAssistantContent(msg.content, attachments.length > 0)
                            : msg.content || (attachments.length > 0 ? "" : "(no content)")}
                        </div>
                        {msg.tool_calls && (
                          <div className="mt-2 text-xs opacity-70">
                            🔧 Tool calls: {msg.tool_calls}
                          </div>
                        )}
                      </Card>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Input Bar */}
            <div className="border-t p-4">
              <div className="max-w-3xl mx-auto">
                {/* Pending file previews */}
                {pendingFiles.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {pendingFiles.map((pf, idx) => (
                      <div
                        key={idx}
                        className="relative group flex items-center gap-1.5 bg-muted rounded-md px-2 py-1 text-xs"
                      >
                        {pf.previewUrl ? (
                          <img
                            src={pf.previewUrl}
                            alt={pf.file.name}
                            className="h-8 w-8 object-cover rounded"
                          />
                        ) : (
                          <span className="text-lg">📄</span>
                        )}
                        <span className="max-w-[120px] truncate">{pf.file.name}</span>
                        <button
                          onClick={() => removePendingFile(idx)}
                          className="ml-1 text-muted-foreground hover:text-destructive transition-colors"
                          title="Remove"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept={ACCEPT_STRING}
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={loading || !activeThread}
                    title="Attach files"
                    className="shrink-0"
                  >
                    📎
                  </Button>
                  <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendMessage()}
                    placeholder="Send a message to Nexus..."
                    disabled={loading}
                  />
                  <Button
                    onClick={sendMessage}
                    disabled={loading || (!input.trim() && pendingFiles.length === 0)}
                  >
                    {loading ? "Thinking..." : "Send"}
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            Select or create a thread to start chatting.
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
          className="max-h-[400px] max-w-full rounded border object-contain cursor-zoom-in"
        />
      </a>
    );
  }

  if (isVideo && url) {
    return (
      <video
        src={url}
        controls
        className="max-h-48 max-w-xs rounded border"
      />
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 bg-background/50 rounded-md px-2 py-1 text-xs border hover:bg-muted transition-colors"
    >
      <span className="text-lg">📄</span>
      <span className="max-w-[160px] truncate">{attachment.filename}</span>
      <span className="opacity-50">
        ({(attachment.sizeBytes / 1024).toFixed(0)} KB)
      </span>
    </a>
  );
}
