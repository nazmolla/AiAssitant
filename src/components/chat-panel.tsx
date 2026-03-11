"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import Box from "@mui/material/Box";
import type { Thread, AttachmentMeta, Message, PendingFile, ThoughtStep, ProcessedMessage } from "./chat-panel-types";
import { extractApprovalMeta, stripApprovalMeta, safeJsonParse, sanitizeAssistantContent } from "./chat-panel-types";
import { ThreadSidebar } from "./thread-sidebar";
import { ChatArea } from "./chat-area";
import { InputBar } from "./input-bar";

export function ChatPanel() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [threadsTotal, setThreadsTotal] = useState(0);
  const [threadsHasMore, setThreadsHasMore] = useState(false);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [thinkingSteps, setThinkingSteps] = useState<Array<{ step: string; detail?: string; timestamp: number }>>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [screenShareEnabled, setScreenShareEnabled] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sendInFlightRef = useRef(false);
  const [actingApproval, setActingApproval] = useState<string | null>(null);
  const [resolvedApprovals, setResolvedApprovals] = useState<Record<string, string>>({});
  const [showSidebar, setShowSidebar] = useState(true);

  // Debounced thread fetch â€” deduplicates concurrent calls and collapses rapid invocations
  const threadFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const threadFetchInFlightRef = useRef<Promise<void> | null>(null);
  const fetchThreadsDebounced = useCallback((immediate = false) => {
    if (threadFetchTimerRef.current) clearTimeout(threadFetchTimerRef.current);
    const doFetch = () => {
      if (threadFetchInFlightRef.current) return; // already in-flight â€” skip
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

  // Screen sharing state
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [screenSharing, setScreenSharing] = useState(false);
  const latestFrameRef = useRef<string | null>(null);
  const frameImgRef = useRef<HTMLImageElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Audio recording state (STT)
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Audio playback state (TTS)
  const [playingTtsId, setPlayingTtsId] = useState<number | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);

  // Audio mode â€” continuous voice conversation
  const [audioMode, setAudioMode] = useState(false);
  const audioModeRef = useRef(false); // ref for use in callbacks
  const audioModeTtsQueue = useRef<string>("");     // accumulates tokens for TTS
  const audioModeSpeaking = useRef(false);           // true while TTS is playing
  const audioModeProcessing = useRef(false);         // true while a TTS chunk is being fetched/played
  const audioModePendingText = useRef<string | null>(null); // transcribed text waiting to be sent

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
        // User cancelled the dialog â€” not an error
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

  // Clean up screen share and SSE on unmount
  useEffect(() => {
    return () => {
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
      if (screenStream) screenStream.getTracks().forEach((t) => t.stop());
      // Clean up audio on unmount
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current = null;
      }
      audioModeRef.current = false;
      // Abort any in-flight SSE fetch
      abortControllerRef.current?.abort();
      // PERF-19: Revoke any orphaned blob URLs from pending file previews
      setPendingFiles((prev) => {
        for (const pf of prev) {
          if (pf.previewUrl) URL.revokeObjectURL(pf.previewUrl);
        }
        return [];
      });
    };
  }, [screenStream]);

  // â”€â”€ Audio Recording (Speech-to-Text) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async function startRecording() {
    // getUserMedia requires a secure context (HTTPS or localhost)
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert(
        "Microphone access is not available.\n\n"
        + "This feature requires HTTPS or localhost. "
        + "If you're accessing the app over HTTP on a non-localhost address, "
        + "your browser blocks microphone access for security reasons."
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Pick the best supported MIME type
      const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ];
      const mimeType = candidates.find((m) => MediaRecorder.isTypeSupported(m)) || "";
      const recorderOptions: MediaRecorderOptions = mimeType ? { mimeType } : {};
      const recorder = new MediaRecorder(stream, recorderOptions);
      const actualMime = recorder.mimeType; // what the browser actually chose
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: actualMime });
        if (blob.size < 100) return; // too short to transcribe

        setTranscribing(true);
        try {
          const ext = actualMime.includes("mp4") || actualMime.includes("m4a") ? "mp4"
            : actualMime.includes("ogg") ? "ogg"
            : "webm";
          const formData = new FormData();
          formData.append("audio", blob, `recording.${ext}`);
          const res = await fetch("/api/audio/transcribe", { method: "POST", body: formData });
          const data = await res.json();
          if (res.ok) {
            if (data.text) {
              if (audioModeRef.current) {
                // In audio mode, auto-send the transcribed text immediately
                audioModePendingText.current = data.text;
                setInput(data.text);
              } else {
                setInput((prev) => (prev ? prev + " " + data.text : data.text));
              }
            }
          } else {
            alert("Transcription failed: " + (data.error || `HTTP ${res.status}`));
          }
        } catch (err) {
          alert("Transcription failed: " + (err instanceof Error ? err.message : String(err)));
        } finally {
          setTranscribing(false);
        }
      };

      recorder.start(250); // collect data every 250ms
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Permission") || msg.includes("NotAllowed")) {
        alert("Microphone permission was denied. Please allow microphone access in your browser settings.");
      } else {
        alert("Could not start recording: " + msg);
      }
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    setRecording(false);
  }

  // â”€â”€ Text-to-Speech â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async function playTts(messageId: number, text: string) {
    // Stop any currently playing TTS
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
      if (playingTtsId === messageId) {
        setPlayingTtsId(null);
        return; // toggle off
      }
    }

    setPlayingTtsId(messageId);
    try {
      // Read preferred TTS voice from localStorage (synced from profile settings)
      let voice = "nova";
      try {
        const stored = localStorage.getItem("nexus_tts_voice");
        if (stored) voice = stored;
      } catch { /* noop */ }

      const res = await fetch("/api/audio/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        alert("Text-to-speech failed: " + (errData?.error || `HTTP ${res.status}`));
        setPlayingTtsId(null);
        return;
      }
      const audioBlob = await res.blob();
      const url = URL.createObjectURL(audioBlob);
      const audio = new Audio(url);
      ttsAudioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        ttsAudioRef.current = null;
        setPlayingTtsId(null);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        ttsAudioRef.current = null;
        setPlayingTtsId(null);
      };

      await audio.play();
    } catch (err) {
      alert("Text-to-speech failed: " + (err instanceof Error ? err.message : String(err)));
      setPlayingTtsId(null);
    }
  }

  // â”€â”€ Audio Mode â€” Continuous Voice Conversation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function toggleAudioMode() {
    const next = !audioMode;
    setAudioMode(next);
    audioModeRef.current = next;
    if (!next) {
      // Turning off: stop any recording, TTS, reset queue
      if (recording) stopRecording();
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current = null;
        setPlayingTtsId(null);
      }
      audioModeTtsQueue.current = "";
      audioModeSpeaking.current = false;
      audioModeProcessing.current = false;
      audioModePendingText.current = null;
    }
  }

  // Auto-send transcribed text in audio mode
  useEffect(() => {
    if (!transcribing && audioModeRef.current && audioModePendingText.current) {
      const text = audioModePendingText.current;
      audioModePendingText.current = null;
      // setInput was already called â€” trigger send on next tick
      setTimeout(() => {
        sendMessageRef.current?.();
      }, 50);
    }
   
  }, [transcribing]);

  // Ref to sendMessage for use in audio mode callbacks
  const sendMessageRef = useRef<(() => void) | null>(null);

  /** Play TTS for audio mode â€” speaks the full response text, then auto-listens */
  async function audioModePlayTts(text: string) {
    if (!audioModeRef.current || !text.trim()) return;
    audioModeSpeaking.current = true;
    audioModeProcessing.current = true;

    try {
      let voice = "nova";
      try {
        const stored = localStorage.getItem("nexus_tts_voice");
        if (stored) voice = stored;
      } catch { /* noop */ }

      const res = await fetch("/api/audio/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice }),
      });

      if (!res.ok || !audioModeRef.current) {
        audioModeSpeaking.current = false;
        audioModeProcessing.current = false;
        return;
      }

      const audioBlob = await res.blob();
      const url = URL.createObjectURL(audioBlob);
      const audio = new Audio(url);
      ttsAudioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        ttsAudioRef.current = null;
        audioModeSpeaking.current = false;
        audioModeProcessing.current = false;
        // Auto-start listening again after TTS finishes
        if (audioModeRef.current) {
          setTimeout(() => {
            if (audioModeRef.current && !recording) {
              startRecording();
            }
          }, 300);
        }
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        ttsAudioRef.current = null;
        audioModeSpeaking.current = false;
        audioModeProcessing.current = false;
      };

      await audio.play();
    } catch {
      audioModeSpeaking.current = false;
      audioModeProcessing.current = false;
    }
  }

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

  // Fetch threads on mount
  useEffect(() => {
    fetchThreadsDebounced(true);
    return () => { if (threadFetchTimerRef.current) clearTimeout(threadFetchTimerRef.current); };
  }, [fetchThreadsDebounced]);

  // Fetch messages when thread changes â€” abort any in-flight SSE from the previous thread
  useEffect(() => {
    abortControllerRef.current?.abort();
    setLoading(false);
    setThinkingSteps([]);
    if (!activeThread) return;
    fetch(`/api/threads/${activeThread}`)
      .then((r) => r.json())
      .then((data) => setMessages(data.messages || []))
      .catch(console.error);
  }, [activeThread]);

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
      fetchThreadsDebounced();
    }
    window.addEventListener("approval-resolved", handleApprovalResolved);
    return () => window.removeEventListener("approval-resolved", handleApprovalResolved);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchThreadsDebounced is a stable debounced ref; listing it recreates the listener on every render
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

      // Refresh messages and threads â€” the agent loop may have added new messages
      if (activeThread) {
        const threadRes = await fetch(`/api/threads/${activeThread}`);
        const threadData = await threadRes.json();
        setMessages(threadData.messages || []);
      }
      fetchThreadsDebounced();

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
    if (sendInFlightRef.current) return;
    if ((!input.trim() && pendingFiles.length === 0 && !screenSharing) || !activeThread) return;
    sendInFlightRef.current = true;

    const userMsg = input;
    const filesToSend = [...pendingFiles];
    setInput("");
    setPendingFiles([]);
    setLoading(true);
    setThinkingSteps([]);
    audioModeTtsQueue.current = ""; // reset TTS accumulator

    // Abort any previous in-flight SSE request, create fresh controller
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    // Capture screen frame if sharing is active
    const frames: string[] = [];
    if (screenSharing) {
      const frame = captureFrame();
      if (frame) frames.push(frame);
    }

    // Optimistic update
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
        thread_id: activeThread,
        role: "user",
        content: userMsg || null,
        tool_calls: null,
        tool_results: null,
        attachments: optimisticAttachments.length > 0 ? JSON.stringify(optimisticAttachments) : null,
        created_at: new Date().toISOString(),
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
        signal: abortControllerRef.current?.signal,
        body: JSON.stringify({
          message: userMsg || (frames.length > 0 ? "(see my screen)" : undefined),
          attachments: uploadedMeta.length > 0 ? uploadedMeta : undefined,
          screenFrames: frames.length > 0 ? frames : undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        // Request failed before stream confirmation â€” remove unresolved optimistic row.
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        if (userMsg) setInput(userMsg);
        setMessages((prev) => [
          ...prev,
          { id: Date.now() + 1, thread_id: activeThread, role: "system", content: `Error: ${errData.error || res.statusText}`, tool_calls: null, tool_results: null, attachments: null, created_at: new Date().toISOString() },
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

      const removeOptimisticIfUnresolved = () => {
        if (seenUserMsg) return;
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      };

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE events from the buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const jsonStr = line.slice(6);
            try {
              const data = JSON.parse(jsonStr);
              if (currentEvent === "message") {
                // Skip the user message we already have optimistically
                if (data.role === "user" && !seenUserMsg) {
                  seenUserMsg = true;
                  // Replace optimistic user msg with server version (has real id + created_at)
                  setMessages((prev) => {
                    const copy = [...prev];
                    // Find the optimistic user message by its stable id
                    const optIdx = copy.findIndex((m) => m.id === optimisticId);
                    if (optIdx >= 0) {
                      copy[optIdx] = data;
                      return copy;
                    }
                    // Fallback: replace last user msg
                    for (let i = copy.length - 1; i >= 0; i--) {
                      if (copy[i].role === "user") {
                        copy[i] = data;
                        return copy;
                      }
                    }
                    return [...copy, data];
                  });
                } else if (data.role === "assistant") {
                  // Replace streaming placeholder if it exists, otherwise append
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
                  // Append new message from the stream (tool results, etc.)
                  setMessages((prev) => [...prev, data as Message]);
                }
              } else if (currentEvent === "token") {
                // Streaming token â€” append to the current streaming assistant message
                const token = data as string;

                // Accumulate for audio mode TTS
                if (audioModeRef.current) {
                  audioModeTtsQueue.current += token;
                }

                setMessages((prev) => {
                  // Find existing streaming placeholder (negative id)
                  const streamIdx = prev.findIndex((m) => m.role === "assistant" && m.id < 0);
                  if (streamIdx >= 0) {
                    const copy = [...prev];
                    copy[streamIdx] = { ...copy[streamIdx], content: (copy[streamIdx].content || "") + token };
                    return copy;
                  }
                  // Create a new streaming placeholder
                  return [...prev, {
                    id: -1,
                    thread_id: activeThread,
                    role: "assistant" as const,
                    content: token,
                    tool_calls: null,
                    tool_results: null,
                    attachments: null,
                    created_at: new Date().toISOString(),
                  }];
                });
              } else if (currentEvent === "status") {
                // Agent thinking/analysis step â€” accumulate for the ThinkingBlock display
                setThinkingSteps((prev) => {
                  const existing = prev.findIndex((s) => s.step === data.step);
                  if (existing >= 0) {
                    // Update detail for an existing step
                    const copy = [...prev];
                    copy[existing] = { ...copy[existing], detail: data.detail, timestamp: Date.now() };
                    return copy;
                  }
                  return [...prev, { step: data.step, detail: data.detail, timestamp: Date.now() }];
                });
              } else if (currentEvent === "done") {
                // Agent loop completed â€” refresh thread list for auto-generated title
                fetchThreadsDebounced();

                // Audio mode: speak the full streamed response
                if (audioModeRef.current && audioModeTtsQueue.current.trim()) {
                  const fullText = audioModeTtsQueue.current;
                  audioModeTtsQueue.current = "";
                  audioModePlayTts(sanitizeAssistantContent(fullText, false));
                }
              } else if (currentEvent === "error") {
                removeOptimisticIfUnresolved();
                if (!seenUserMsg && userMsg) setInput(userMsg);
                setMessages((prev) => [
                  ...prev,
                  { id: Date.now() + 1, thread_id: activeThread, role: "system", content: `Error: ${data.error}`, tool_calls: null, tool_results: null, attachments: null, created_at: new Date().toISOString() },
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
      // Don't show abort errors (user navigated away or sent a new message)
      if (err instanceof DOMException && err.name === "AbortError") return;
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      if (userMsg) setInput(userMsg);
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, thread_id: activeThread, role: "system", content: `Error: ${err}`, tool_calls: null, tool_results: null, attachments: null, created_at: new Date().toISOString() },
      ]);
    } finally {
      setLoading(false);
      sendInFlightRef.current = false;
    }
  }

  // Keep sendMessageRef in sync for audio mode auto-send
  sendMessageRef.current = sendMessage;

  const activeThreadTitle = useMemo(() => threads.find(t => t.id === activeThread)?.title, [threads, activeThread]);

  // Pre-process messages: group thinking steps into collapsible blocks
  const processedMessages: ProcessedMessage[] = useMemo(() => {
    const result: ProcessedMessage[] = [];
    let pendingThoughts: ThoughtStep[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      // Tool messages â€” collect results into the current thought step
      if (msg.role === "tool") {
        if (pendingThoughts.length > 0) {
          const lastThought = pendingThoughts[pendingThoughts.length - 1];
          // Try to match tool name from the preceding assistant's tool_calls
          let name = "tool";
          if (lastThought.toolCalls.length > 0) {
            // Tool results come in the same order as tool_calls
            const idx = lastThought.toolResults.length;
            if (idx < lastThought.toolCalls.length) {
              name = lastThought.toolCalls[idx].name;
            }
          }
          lastThought.toolResults.push({
            name,
            result: msg.content || "(no output)",
          });
          // Collect tool attachments too
          if (msg.attachments) {
            const toolAtts: AttachmentMeta[] = safeJsonParse(msg.attachments, []);
            lastThought.attachments.push(...toolAtts);
          }
        }
        continue;
      }

      // Assistant message WITH tool_calls = thinking step
      if (msg.role === "assistant" && msg.tool_calls) {
        let parsedCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
        try { parsedCalls = JSON.parse(msg.tool_calls).map((tc: { name: string; arguments: Record<string, unknown> }) => ({ name: tc.name, args: tc.arguments })); } catch { /* ignore */ }
        pendingThoughts.push({
          thinking: msg.content,
          toolCalls: parsedCalls,
          toolResults: [],
          attachments: safeJsonParse<AttachmentMeta[]>(msg.attachments, []),
        });
        continue;
      }

      // Final assistant message (no tool_calls) = visible response with collected thoughts
      if (msg.role === "assistant") {
        const attachments: AttachmentMeta[] = safeJsonParse<AttachmentMeta[]>(msg.attachments, []);
        const hasAtt = attachments.length > 0;
        const content = sanitizeAssistantContent(msg.content, hasAtt);
        // Skip empty assistant messages unless they have attachments
        if ((!content || content === "(no content)") && !hasAtt) {
          // Flush pending thoughts since this message is skipped
          pendingThoughts = [];
          continue;
        }
        result.push({
          msg,
          attachments,
          approvalMeta: null,
          displayContent: msg.content,
          thoughts: pendingThoughts,
        });
        pendingThoughts = [];
        continue;
      }

      // User / system messages
      const attachments: AttachmentMeta[] = safeJsonParse<AttachmentMeta[]>(msg.attachments, []);
      const approvalMeta = msg.role === "system" ? extractApprovalMeta(msg.content) : null;
      const displayContent = approvalMeta ? stripApprovalMeta(msg.content) : msg.content;
      // Flush any orphaned thoughts before user/system messages
      pendingThoughts = [];
      result.push({ msg, attachments, approvalMeta, displayContent, thoughts: [] });
    }

    // If thoughts are still pending (streaming â€” final assistant message hasn't arrived yet),
    // synthesize a placeholder so the user can see the agent's progress in real-time
    if (pendingThoughts.length > 0 && loading) {
      result.push({
        msg: { id: -1, thread_id: "", role: "assistant", content: null, tool_calls: null, tool_results: null, attachments: null, created_at: null },
        attachments: [],
        approvalMeta: null,
        displayContent: null,
        thoughts: pendingThoughts,
      });
    } else if (loading && thinkingSteps.length > 0 && !result.some((r) => r.msg.role === "assistant")) {
      // No assistant message yet, but we have thinking steps â€” show a placeholder
      result.push({
        msg: { id: -1, thread_id: "", role: "assistant", content: null, tool_calls: null, tool_results: null, attachments: null, created_at: null },
        attachments: [],
        approvalMeta: null,
        displayContent: null,
        thoughts: [],
      });
    }

    return result;
  }, [messages, loading, thinkingSteps]);

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
          loading={loading}
          thinkingSteps={thinkingSteps}
          activeThread={activeThread}
          activeThreadTitle={activeThreadTitle}
          showSidebar={showSidebar}
          onBackToSidebar={() => setShowSidebar(true)}
          playingTtsId={playingTtsId}
          onPlayTts={playTts}
          actingApproval={actingApproval}
          resolvedApprovals={resolvedApprovals}
          onApproval={handleApproval}
        />
        {activeThread && (
          <InputBar
            input={input}
            onInputChange={setInput}
            onSendMessage={sendMessage}
            loading={loading}
            activeThread={activeThread}
            pendingFiles={pendingFiles}
            onFileSelect={handleFileSelect}
            onRemovePendingFile={removePendingFile}
            fileInputRef={fileInputRef}
            recording={recording}
            transcribing={transcribing}
            onStartRecording={startRecording}
            onStopRecording={stopRecording}
            screenShareEnabled={screenShareEnabled}
            screenSharing={screenSharing}
            onStartScreenShare={startScreenShare}
            onStopScreenShare={stopScreenShare}
            audioMode={audioMode}
            audioModeSpeaking={audioModeSpeaking.current}
            onToggleAudioMode={toggleAudioMode}
            latestFrameRef={latestFrameRef}
            frameImgRef={frameImgRef}
          />
        )}
      </Box>
    </Box>
  );
}
