// Temporary script to write the new chat-panel.tsx - delete after use
const fs = require('fs');
const path = require('path');

const content = `"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Box from "@mui/material/Box";
import type { Thread } from "./chat-panel-types";
import { processMessages } from "./chat-panel-types";
import { ThreadSidebar } from "./thread-sidebar";
import { ChatArea } from "./chat-area";
import { InputBar } from "./input-bar";
import { useScreenShare } from "@/hooks/use-screen-share";
import { useAudioControls } from "@/hooks/use-audio-controls";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useChatStream } from "@/hooks/use-chat-stream";

export function ChatPanel() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadsTotal, setThreadsTotal] = useState(0);
  const [threadsHasMore, setThreadsHasMore] = useState(false);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [actingApproval, setActingApproval] = useState<string | null>(null);
  const [resolvedApprovals, setResolvedApprovals] = useState<Record<string, string>>({});
  const [showSidebar, setShowSidebar] = useState(true);

  // \u2500\u2500 Debounced thread fetch \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const threadFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const threadFetchInFlightRef = useRef<Promise<void> | null>(null);
  const fetchThreadsDebounced = useCallback((immediate = false) => {
    if (threadFetchTimerRef.current) clearTimeout(threadFetchTimerRef.current);
    const doFetch = () => {
      if (threadFetchInFlightRef.current) return;
      const p = fetch("/api/threads")
        .then((r) => r.json())
        .then((d) => {
          if (d && Array.isArray(d.data)) {
            setThreads(d.data);
            setThreadsTotal(d.total ?? d.data.length);
            setThreadsHasMore(d.hasMore ?? false);
          }
        })
        .catch(console.error)
        .finally(() => { threadFetchInFlightRef.current = null; });
      threadFetchInFlightRef.current = p;
    };
    if (immediate) { doFetch(); return; }
    threadFetchTimerRef.current = setTimeout(doFetch, 400);
  }, []);

  // \u2500\u2500 Extracted hooks \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  const screenShare = useScreenShare();
  const fileUpload = useFileUpload();
  const sendMessageRef = useRef<(() => void) | null>(null);

  const audioControls = useAudioControls({
    onTranscription: (text) => {
      if (audioControls.audioModeRef.current) {
        setInput(text);
      } else {
        setInput((prev) => (prev ? prev + " " + text : text));
      }
    },
    sendMessageRef,
  });

  const inputRef = useRef(input);
  inputRef.current = input;
  const pendingFilesRef = useRef(fileUpload.pendingFiles);
  pendingFilesRef.current = fileUpload.pendingFiles;

  const chatStream = useChatStream({
    activeThread,
    getInput: () => inputRef.current,
    clearInput: () => setInput(""),
    restoreInput: (text) => setInput(text),
    getPendingFiles: () => pendingFilesRef.current,
    clearPendingFiles: () => fileUpload.setPendingFiles([]),
    uploadFile: fileUpload.uploadFile,
    isScreenSharing: () => screenShare.screenSharing,
    captureFrame: screenShare.captureFrame,
    audioModeRef: audioControls.audioModeRef,
    audioModeTtsQueue: audioControls.audioModeTtsQueue,
    onAudioModePlayTts: audioControls.audioModePlayTts,
    onThreadsRefresh: () => fetchThreadsDebounced(),
  });

  sendMessageRef.current = chatStream.sendMessage;

  // \u2500\u2500 Effects \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  useEffect(() => {
    fetchThreadsDebounced(true);
    return () => { if (threadFetchTimerRef.current) clearTimeout(threadFetchTimerRef.current); };
  }, [fetchThreadsDebounced]);

  useEffect(() => {
    chatStream.abortStream();
    chatStream.setLoading(false);
    chatStream.setThinkingSteps([]);
    if (!activeThread) return;
    fetch(\`/api/threads/\${activeThread}\`)
      .then((r) => r.json())
      .then((data) => chatStream.setMessages(data.messages || []))
      .catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread]);

  useEffect(() => {
    function handleApprovalResolved() {
      if (activeThread) {
        fetch(\`/api/threads/\${activeThread}\`)
          .then((r) => r.json())
          .then((data) => chatStream.setMessages(data.messages || []))
          .catch(console.error);
      }
      fetchThreadsDebounced();
    }
    window.addEventListener("approval-resolved", handleApprovalResolved);
    return () => window.removeEventListener("approval-resolved", handleApprovalResolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread]);

  useEffect(() => {
    return () => {
      chatStream.abortStream();
      fileUpload.setPendingFiles((prev) => {
        for (const pf of prev) {
          if (pf.previewUrl) URL.revokeObjectURL(pf.previewUrl);
        }
        return [];
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // \u2500\u2500 Thread CRUD \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  async function createThread() {
    const res = await fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New Thread" }),
    });
    const thread = await res.json();
    setThreads((prev) => [thread, ...prev]);
    setActiveThread(thread.id);
    chatStream.setMessages([]);
    fileUpload.setPendingFiles([]);
  }

  async function handleDeleteThread(threadId: string) {
    if (!confirm("Delete this thread and all its messages?")) return;
    try {
      const res = await fetch(\`/api/threads/\${threadId}\`, { method: "DELETE" });
      if (!res.ok) { const err = await res.json(); console.error(err.error); return; }
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
      if (activeThread === threadId) {
        setActiveThread(null);
        chatStream.setMessages([]);
      }
    } catch (err) { console.error("Failed to delete thread:", err); }
  }

  // \u2500\u2500 Approval handling \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

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
        alert(data.error || \`Failed to \${action === "approved" ? "approve" : "deny"} (HTTP \${res.status})\`);
        return;
      }

      setResolvedApprovals((prev) => ({ ...prev, [approvalId]: data.alreadyResolved ? data.status : action }));

      if (data.continuationError) {
        console.warn("Agent continuation error:", data.continuationError);
      }

      if (activeThread) {
        const threadRes = await fetch(\`/api/threads/\${activeThread}\`);
        const threadData = await threadRes.json();
        chatStream.setMessages(threadData.messages || []);
      }
      fetchThreadsDebounced();
      window.dispatchEvent(new CustomEvent("approval-resolved", { detail: data }));
    } catch (err) {
      console.error("Approval action failed:", err);
      alert(\`Approval action failed: \${err instanceof Error ? err.message : String(err)}\`);
    } finally {
      setActingApproval(null);
    }
  }

  // \u2500\u2500 Derived data \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  const activeThreadTitle = useMemo(() => threads.find(t => t.id === activeThread)?.title, [threads, activeThread]);
  const processedMessages = useMemo(
    () => processMessages(chatStream.messages, chatStream.loading, chatStream.thinkingSteps),
    [chatStream.messages, chatStream.loading, chatStream.thinkingSteps]
  );

  const handleSelectThread = useCallback((id: string) => {
    if (activeThread !== id) setActiveThread(id);
    setShowSidebar(false);
  }, [activeThread]);

  const handleLoadMore = useCallback(() => {
    fetch(\`/api/threads?limit=50&offset=\${threads.length}\`)
      .then((r) => r.json())
      .then((d) => {
        if (d && Array.isArray(d.data)) {
          setThreads((prev) => [...prev, ...d.data]);
          setThreadsTotal(d.total ?? threads.length + d.data.length);
          setThreadsHasMore(d.hasMore ?? false);
        }
      })
      .catch(console.error);
  }, [threads.length]);

  // \u2500\u2500 Render \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  return (
    <Box sx={{ display: "flex", height: "100%" }}>
      <ThreadSidebar
        threads={threads}
        threadsTotal={threadsTotal}
        threadsHasMore={threadsHasMore}
        activeThread={activeThread}
        showSidebar={showSidebar}
        onSelectThread={handleSelectThread}
        onCreateThread={createThread}
        onDeleteThread={handleDeleteThread}
        onLoadMore={handleLoadMore}
      />
      <Box
        sx={{
          display: { xs: !showSidebar ? "flex" : "none", sm: "flex" },
          flex: 1,
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <ChatArea
          processedMessages={processedMessages}
          loading={chatStream.loading}
          thinkingSteps={chatStream.thinkingSteps}
          activeThread={activeThread}
          activeThreadTitle={activeThreadTitle}
          showSidebar={showSidebar}
          onBackToSidebar={() => setShowSidebar(true)}
          playingTtsId={audioControls.playingTtsId}
          onPlayTts={audioControls.playTts}
          actingApproval={actingApproval}
          resolvedApprovals={resolvedApprovals}
          onApproval={handleApproval}
        />
        {activeThread && (
          <InputBar
            input={input}
            onInputChange={setInput}
            onSendMessage={chatStream.sendMessage}
            loading={chatStream.loading}
            activeThread={activeThread}
            pendingFiles={fileUpload.pendingFiles}
            onFileSelect={fileUpload.handleFileSelect}
            onRemovePendingFile={fileUpload.removePendingFile}
            fileInputRef={fileUpload.fileInputRef}
            recording={audioControls.recording}
            transcribing={audioControls.transcribing}
            onStartRecording={audioControls.startRecording}
            onStopRecording={audioControls.stopRecording}
            screenShareEnabled={screenShare.screenShareEnabled}
            screenSharing={screenShare.screenSharing}
            onStartScreenShare={screenShare.startScreenShare}
            onStopScreenShare={screenShare.stopScreenShare}
            audioMode={audioControls.audioMode}
            audioModeSpeaking={audioControls.audioModeSpeaking.current}
            onToggleAudioMode={audioControls.toggleAudioMode}
            latestFrameRef={screenShare.latestFrameRef}
            frameImgRef={screenShare.frameImgRef}
          />
        )}
      </Box>
    </Box>
  );
}
`;

fs.writeFileSync(path.join(process.cwd(), 'src', 'components', 'chat-panel.tsx'), content);
console.log('Done. Lines:', content.split('\n').length);
