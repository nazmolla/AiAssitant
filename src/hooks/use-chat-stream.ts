"use client";

import { useState, useRef, useCallback } from "react";
import type { Message, AttachmentMeta, PendingFile, ThinkingStep } from "@/components/chat-panel-types";
import { sanitizeAssistantContent } from "@/components/chat-panel-types";

export interface UseChatStreamOptions {
  activeThread: string | null;
  getInput: () => string;
  clearInput: () => void;
  restoreInput: (text: string) => void;
  getPendingFiles: () => PendingFile[];
  clearPendingFiles: () => void;
  uploadFile: (file: File, threadId: string) => Promise<AttachmentMeta>;
  isScreenSharing: () => boolean;
  captureFrame: () => string | null;
  audioModeRef: React.MutableRefObject<boolean>;
  audioModeTtsQueue: React.MutableRefObject<string>;
  onAudioModePlayTts: (text: string) => void;
  onThreadsRefresh: () => void;
}

export interface UseChatStreamReturn {
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  thinkingSteps: ThinkingStep[];
  setThinkingSteps: React.Dispatch<React.SetStateAction<ThinkingStep[]>>;
  sendMessage: (overrideThreadId?: string) => Promise<void>;
  abortStream: () => void;
}

export function useChatStream(options: UseChatStreamOptions): UseChatStreamReturn {
  const {
    activeThread,
    getInput,
    clearInput,
    restoreInput,
    getPendingFiles,
    clearPendingFiles,
    uploadFile,
    isScreenSharing,
    captureFrame,
    audioModeRef,
    audioModeTtsQueue,
    onAudioModePlayTts,
    onThreadsRefresh,
  } = options;

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sendInFlightRef = useRef(false);

  const abortStream = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const sendMessage = useCallback(async (overrideThreadId?: string) => {
    if (sendInFlightRef.current) return;
    const input = getInput();
    const filesToSend = getPendingFiles();
    const sharing = isScreenSharing();
    const effectiveThreadId = overrideThreadId ?? activeThread;
    if ((!input.trim() && filesToSend.length === 0 && !sharing) || !effectiveThreadId) return;
    sendInFlightRef.current = true;

    const userMsg = input;
    clearInput();
    clearPendingFiles();
    setLoading(true);
    setThinkingSteps([]);
    audioModeTtsQueue.current = "";

    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    const frames: string[] = [];
    if (sharing) {
      const frame = captureFrame();
      if (frame) frames.push(frame);
    }

    const optimisticId = Date.now();
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
        id: optimisticId,
        thread_id: effectiveThreadId,
        role: "user",
        content: userMsg || null,
        tool_calls: null,
        tool_results: null,
        attachments: optimisticAttachments.length > 0 ? JSON.stringify(optimisticAttachments) : null,
        created_at: new Date().toISOString(),
      },
    ]);

    try {
      const uploadedMeta: AttachmentMeta[] = [];
      for (const pf of filesToSend) {
        const meta = await uploadFile(pf.file, effectiveThreadId);
        uploadedMeta.push(meta);
        if (pf.previewUrl) URL.revokeObjectURL(pf.previewUrl);
      }

      const res = await fetch(`/api/threads/${effectiveThreadId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortControllerRef.current?.signal,
        body: JSON.stringify({
          message: userMsg || (frames.length > 0 ? "(see my screen)" : undefined),
          attachments: uploadedMeta.length > 0 ? uploadedMeta : undefined,
          screenFrames: frames.length > 0 ? frames : undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        if (userMsg) restoreInput(userMsg);
        setMessages((prev) => [
          ...prev,
          { id: Date.now() + 1, thread_id: effectiveThreadId, role: "system", content: `Error: ${errData.error || res.statusText}`, tool_calls: null, tool_results: null, attachments: null, created_at: new Date().toISOString() },
        ]);
        return;
      }

      // Consume SSE stream
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let buffer = "";
      let seenUserMsg = false;
      let currentEvent = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const jsonStr = line.slice(6);
            try {
              const data = JSON.parse(jsonStr);
              if (currentEvent === "message") {
                if (data.role === "user" && !seenUserMsg) {
                  seenUserMsg = true;
                  setMessages((prev) => {
                    const copy = [...prev];
                    const optIdx = copy.findIndex((m) => m.id === optimisticId);
                    if (optIdx >= 0) { copy[optIdx] = data; return copy; }
                    for (let i = copy.length - 1; i >= 0; i--) {
                      if (copy[i].role === "user") { copy[i] = data; return copy; }
                    }
                    return [...copy, data];
                  });
                } else if (data.role === "assistant") {
                  setMessages((prev) => {
                    const streamIdx = prev.findIndex((m) => m.role === "assistant" && m.id < 0);
                    if (streamIdx >= 0) {
                      const copy = [...prev];
                      copy[streamIdx] = data as Message;
                      return copy;
                    }
                    return [...prev, data as Message];
                  });
                } else {
                  setMessages((prev) => [...prev, data as Message]);
                }
              } else if (currentEvent === "token") {
                const token = data as string;
                if (audioModeRef.current) {
                  audioModeTtsQueue.current += token;
                }
                setMessages((prev) => {
                  const streamIdx = prev.findIndex((m) => m.role === "assistant" && m.id < 0);
                  if (streamIdx >= 0) {
                    const copy = [...prev];
                    copy[streamIdx] = { ...copy[streamIdx], content: (copy[streamIdx].content || "") + token };
                    return copy;
                  }
                  return [...prev, {
                    id: -1,
                    thread_id: effectiveThreadId,
                    role: "assistant" as const,
                    content: token,
                    tool_calls: null,
                    tool_results: null,
                    attachments: null,
                    created_at: new Date().toISOString(),
                  }];
                });
              } else if (currentEvent === "status") {
                setThinkingSteps((prev) => {
                  const existing = prev.findIndex((s) => s.step === data.step);
                  if (existing >= 0) {
                    const copy = [...prev];
                    copy[existing] = { ...copy[existing], detail: data.detail, timestamp: Date.now() };
                    return copy;
                  }
                  return [...prev, { step: data.step, detail: data.detail, timestamp: Date.now() }];
                });
              } else if (currentEvent === "done") {
                onThreadsRefresh();
                if (audioModeRef.current && audioModeTtsQueue.current.trim()) {
                  const fullText = audioModeTtsQueue.current;
                  audioModeTtsQueue.current = "";
                  onAudioModePlayTts(sanitizeAssistantContent(fullText, false));
                }
              } else if (currentEvent === "error") {
                if (!seenUserMsg) {
                  setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
                  if (userMsg) restoreInput(userMsg);
                }
                setMessages((prev) => [
                  ...prev,
                  { id: Date.now() + 1, thread_id: effectiveThreadId, role: "system", content: `Error: ${data.error}`, tool_calls: null, tool_results: null, attachments: null, created_at: new Date().toISOString() },
                ]);
              }
            } catch {
              // Ignore malformed JSON
            }
            currentEvent = "";
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      if (userMsg) restoreInput(userMsg);
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, thread_id: effectiveThreadId, role: "system", content: `Error: ${err}`, tool_calls: null, tool_results: null, attachments: null, created_at: new Date().toISOString() },
      ]);
    } finally {
      setLoading(false);
      sendInFlightRef.current = false;
    }
  }, [activeThread, getInput, clearInput, restoreInput, getPendingFiles, clearPendingFiles, uploadFile, isScreenSharing, captureFrame, audioModeRef, audioModeTtsQueue, onAudioModePlayTts, onThreadsRefresh]);

  return {
    messages,
    setMessages,
    loading,
    setLoading,
    thinkingSteps,
    setThinkingSteps,
    sendMessage,
    abortStream,
  };
}
