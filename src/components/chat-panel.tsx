"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Box from "@mui/material/Box";
import { useSession } from "next-auth/react";
import type { Thread } from "./chat-panel-types";
import { processMessages } from "./chat-panel-types";
import { ThreadSidebar } from "./thread-sidebar";
import { ChatArea } from "./chat-area";
import { InputBar } from "./input-bar";
import { useScreenShare } from "@/hooks/use-screen-share";
import { useAudioControls } from "@/hooks/use-audio-controls";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useChatStream } from "@/hooks/use-chat-stream";
import { useConfirm } from "@/hooks/use-confirm";
import { useToast } from "@/hooks/use-toast";

export interface ChatPanelProps {
  /** Called with (() => void) so the app-level burger can open the thread drawer */
  openThreadDrawerRef?: { current: (() => void) | null };
  /** App navigation items to show at the bottom of the thread drawer */
  navItems?: { value: string; label: string; icon: React.ReactElement }[];
  activeNavTab?: string;
  onNavigate?: (tab: string) => void;
}

export function ChatPanel({ openThreadDrawerRef, navItems, activeNavTab, onNavigate }: ChatPanelProps = {}) {
  const { data: session } = useSession();
  const [userName, setUserName] = useState<string | undefined>(
    (session?.user as { name?: string } | undefined)?.name ?? undefined
  );

  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadsTotal, setThreadsTotal] = useState(0);
  const [threadsHasMore, setThreadsHasMore] = useState(false);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [actingApproval, setActingApproval] = useState<string | null>(null);
  const [resolvedApprovals, setResolvedApprovals] = useState<Record<string, string>>({});
  const [showSidebar, setShowSidebar] = useState(false);
  // Tracks when a send is pending after auto-creating a thread so the
  // thread-load useEffect doesn't overwrite the optimistic message state.
  const pendingSendRef = useRef(false);

  useEffect(() => {
    fetch("/api/config/profile")
      .then((r) => r.json())
      .then((data) => {
        const name = data.display_name || data.email?.split("@")[0];
        if (name) setUserName(name);
      })
      .catch(() => {/* keep session fallback */});
  }, []);

  // Wire up the external ref so the app-level burger can open this drawer
  useEffect(() => {
    if (openThreadDrawerRef) {
      openThreadDrawerRef.current = () => setShowSidebar(true);
    }
    return () => {
      if (openThreadDrawerRef) openThreadDrawerRef.current = null;
    };
  }, [openThreadDrawerRef]);

  // ── Debounced thread fetch ────────────────────────────────────────────────────
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

  // ── Extracted hooks ─────────────────────────────────────────────────────────
  const { confirmDialog, openConfirm } = useConfirm();
  const { toastSnackbar, showToast } = useToast();
  const screenShare = useScreenShare({ onError: showToast });
  const fileUpload = useFileUpload();
  const sendMessageRef = useRef<((overrideThreadId?: string) => void) | null>(null);

  const audioControls = useAudioControls({
    onTranscription: (text) => {
      if (audioControls.audioModeRef.current) {
        setInput(text);
      } else {
        setInput((prev) => (prev ? prev + " " + text : text));
      }
    },
    sendMessageRef,
    onError: showToast,
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

  // ── Effects ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetchThreadsDebounced(true);
    return () => { if (threadFetchTimerRef.current) clearTimeout(threadFetchTimerRef.current); };
  }, [fetchThreadsDebounced]);

  useEffect(() => {
    chatStream.setThinkingSteps([]);
    if (!activeThread) return;
    // MUST check before abortStream: if a welcome-screen send just started,
    // abortStream would kill the in-flight SSE fetch. Skip everything and let
    // sendMessage own the state for this thread.
    if (pendingSendRef.current) { pendingSendRef.current = false; return; }
    chatStream.abortStream();
    chatStream.setLoading(false);
    fetch(`/api/threads/${activeThread}`)
      .then((r) => r.json())
      .then((data) => chatStream.setMessages(data.messages || []))
      .catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread]);

  useEffect(() => {
    function handleApprovalResolved() {
      if (activeThread) {
        fetch(`/api/threads/${activeThread}`)
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

  // ── Thread CRUD ─────────────────────────────────────────────────────────

  async function createThread(): Promise<string> {
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
    return thread.id;
  }

  async function handleDeleteThread(threadId: string) {
    if (!(await openConfirm("Delete this thread and all its messages?"))) return;
    try {
      const res = await fetch(`/api/threads/${threadId}`, { method: "DELETE" });
      if (!res.ok) { const err = await res.json(); console.error(err.error); return; }
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
      if (activeThread === threadId) {
        setActiveThread(null);
        chatStream.setMessages([]);
      }
    } catch (err) { console.error("Failed to delete thread:", err); }
  }

  // ── Auto-create thread on first send ────────────────────────────────────────

  // Wrap sendMessage so that if there's no active thread, we create one first
  const handleSendMessage = useCallback(async () => {
    if (!activeThread) {
      if (!inputRef.current.trim() && pendingFilesRef.current.length === 0) return;
      // Set flag BEFORE createThread so the activeThread useEffect skips its
      // fetch (which would wipe the optimistic message added by sendMessage).
      pendingSendRef.current = true;
      const newThreadId = await createThread();
      // Do NOT clear pendingSendRef here — the activeThread useEffect will clear
      // it when it fires for the new thread, preventing it from fetching and
      // wiping the optimistic message that sendMessage is about to add.
      chatStream.sendMessage(newThreadId);
    } else {
      chatStream.sendMessage();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread]);

  // ── Approval handling ───────────────────────────────────────────────────

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
        showToast(data.error || `Failed to ${action === "approved" ? "approve" : "deny"} (HTTP ${res.status})`);
        return;
      }

      setResolvedApprovals((prev) => ({ ...prev, [approvalId]: data.alreadyResolved ? data.status : action }));

      if (data.continuationError) {
        console.warn("Agent continuation error:", data.continuationError);
      }

      if (activeThread) {
        const threadRes = await fetch(`/api/threads/${activeThread}`);
        const threadData = await threadRes.json();
        chatStream.setMessages(threadData.messages || []);
      }
      fetchThreadsDebounced();
      window.dispatchEvent(new CustomEvent("approval-resolved", { detail: data }));
    } catch (err) {
      console.error("Approval action failed:", err);
      showToast(`Approval action failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setActingApproval(null);
    }
  }

  // ── Restore-to-message ──────────────────────────────────────────────────

  async function handleRestoreToMessage(messageId: number) {
    if (!activeThread) return;
    if (!(await openConfirm("Restore to this message? All messages after it will be deleted and this message will be resent."))) return;

    try {
      const res = await fetch(`/api/threads/${activeThread}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || `Restore failed (HTTP ${res.status})`);
        return;
      }

      chatStream.setMessages((prev) => prev.filter((m) => m.id < messageId));

      if (data.content) {
        setInput(data.content);
        requestAnimationFrame(() => {
          sendMessageRef.current?.();
        });
      }

      fetchThreadsDebounced();
    } catch (err) {
      console.error("Restore failed:", err);
      showToast(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // ── Derived data ──────────────────────────────────────────────────────────

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
    fetch(`/api/threads?limit=50&offset=${threads.length}`)
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

  const handleCloseSidebar = useCallback(() => setShowSidebar(false), []);

  // ── Render ──────────────────────────────────────────────────────────────

  const isWelcome = !activeThread;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Thread drawer */}
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
        onClose={handleCloseSidebar}
        navItems={navItems}
        activeNavTab={activeNavTab}
        onNavigate={onNavigate}
      />

      {/* Main area */}
      <Box sx={{ display: "flex", flex: 1, flexDirection: "column", minHeight: 0 }}>
        {/* Chat area (messages or welcome screen) */}
        <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <ChatArea
            processedMessages={processedMessages}
            loading={chatStream.loading}
            thinkingSteps={chatStream.thinkingSteps}
            activeThread={activeThread}
            activeThreadTitle={activeThreadTitle}
            showSidebar={showSidebar}
            userName={userName}
            playingTtsId={audioControls.playingTtsId}
            onPlayTts={audioControls.playTts}
            actingApproval={actingApproval}
            resolvedApprovals={resolvedApprovals}
            onApproval={handleApproval}
            onRestoreToMessage={handleRestoreToMessage}
          />
        </Box>

        {/* Input bar — always visible */}
        {isWelcome ? (
          <Box sx={{ pb: 4, pt: 2 }}>
            <InputBar
              input={input}
              onInputChange={setInput}
              onSendMessage={handleSendMessage}
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
              welcomeMode
            />
          </Box>
        ) : (
          <InputBar
            input={input}
            onInputChange={setInput}
            onSendMessage={handleSendMessage}
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
      {confirmDialog}
      {toastSnackbar}
    </Box>
  );
}
