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
import Collapse from "@mui/material/Collapse";
import SendIcon from "@mui/icons-material/Send";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import ScreenShareIcon from "@mui/icons-material/ScreenShare";
import StopScreenShareIcon from "@mui/icons-material/StopScreenShare";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import PsychologyIcon from "@mui/icons-material/Psychology";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import BuildIcon from "@mui/icons-material/Build";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import HeadsetMicIcon from "@mui/icons-material/HeadsetMic";
import MarkdownMessage from "./markdown-message";

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
  created_at: string | null;
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

/** Safely parse JSON with a fallback — prevents component crashes on malformed data */
function safeJsonParse<T>(json: string | null, fallback: T): T {
  if (!json) return fallback;
  try { return JSON.parse(json); } catch { return fallback; }
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
  const [thinkingSteps, setThinkingSteps] = useState<Array<{ step: string; detail?: string; timestamp: number }>>([]);
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

  // Audio recording state (STT)
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Audio playback state (TTS)
  const [playingTtsId, setPlayingTtsId] = useState<number | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);

  // Audio mode — continuous voice conversation
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
      // Clean up audio on unmount
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current = null;
      }
      audioModeRef.current = false;
    };
  }, [screenStream]);

  // ── Audio Recording (Speech-to-Text) ──────────────────────────

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

  // ── Text-to-Speech ────────────────────────────────────────────

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

  // ── Audio Mode — Continuous Voice Conversation ─────────────────

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
      // setInput was already called — trigger send on next tick
      setTimeout(() => {
        sendMessageRef.current?.();
      }, 50);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcribing]);

  // Ref to sendMessage for use in audio mode callbacks
  const sendMessageRef = useRef<(() => void) | null>(null);

  /** Play TTS for audio mode — speaks the full response text, then auto-listens */
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
    setThinkingSteps([]);
    audioModeTtsQueue.current = ""; // reset TTS accumulator

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
        body: JSON.stringify({
          message: userMsg || (frames.length > 0 ? "(see my screen)" : undefined),
          attachments: uploadedMeta.length > 0 ? uploadedMeta : undefined,
          screenFrames: frames.length > 0 ? frames : undefined,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
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
                    // Find last optimistic user message
                    for (let i = copy.length - 1; i >= 0; i--) {
                      if (copy[i].role === "user" && copy[i].id === Date.now()) {
                        copy[i] = data;
                        return copy;
                      }
                    }
                    // If no match (id changed), replace last user msg
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
                // Streaming token — append to the current streaming assistant message
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
                // Agent thinking/analysis step — accumulate for the ThinkingBlock display
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
                // Agent loop completed — refresh thread list for auto-generated title
                fetch("/api/threads").then((r) => r.json()).then((d) => { if (Array.isArray(d)) setThreads(d); }).catch(console.error);

                // Audio mode: speak the full streamed response
                if (audioModeRef.current && audioModeTtsQueue.current.trim()) {
                  const fullText = audioModeTtsQueue.current;
                  audioModeTtsQueue.current = "";
                  audioModePlayTts(sanitizeAssistantContent(fullText, false));
                }
              } else if (currentEvent === "error") {
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
      setMessages((prev) => [
        ...prev,
        { id: Date.now() + 1, thread_id: activeThread, role: "system", content: `Error: ${err}`, tool_calls: null, tool_results: null, attachments: null, created_at: new Date().toISOString() },
      ]);
    } finally {
      setLoading(false);
    }
  }

  // Keep sendMessageRef in sync for audio mode auto-send
  sendMessageRef.current = sendMessage;

  const activeThreadTitle = useMemo(() => threads.find(t => t.id === activeThread)?.title, [threads, activeThread]);

  // Pre-process messages: group thinking steps into collapsible blocks
  interface ThoughtStep {
    thinking: string | null;      // assistant reasoning text
    toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
    toolResults: Array<{ name: string; result: string }>;
    attachments: AttachmentMeta[];
  }
  interface ProcessedMessage {
    msg: Message;
    attachments: AttachmentMeta[];
    approvalMeta: ReturnType<typeof extractApprovalMeta>;
    displayContent: string | null;
    thoughts: ThoughtStep[];
  }

  const processedMessages: ProcessedMessage[] = useMemo(() => {
    const result: ProcessedMessage[] = [];
    let pendingThoughts: ThoughtStep[] = [];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];

      // Tool messages — collect results into the current thought step
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

    // If thoughts are still pending (streaming — final assistant message hasn't arrived yet),
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
      // No assistant message yet, but we have thinking steps — show a placeholder
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
                {processedMessages.map(({ msg, attachments, approvalMeta, displayContent, thoughts }, pmIdx) => {

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

                        {/* Agent Thinking Steps — shown on the last assistant message */}
                        {msg.role === "assistant" && pmIdx === processedMessages.length - 1 && thinkingSteps.length > 0 && (
                          <ThinkingBlock steps={thinkingSteps} autoExpand={loading} />
                        )}

                        {/* Collapsible Thoughts */}
                        {thoughts.length > 0 && <ThoughtsBlock thoughts={thoughts} autoExpand={loading} />}

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
                            onClick={() => playTts(msg.id, sanitizeAssistantContent(msg.content, false))}
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

                {/* Audio mode indicator */}
                {audioMode && (
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, px: 1.5, py: 1, borderRadius: 2, bgcolor: "primary.main", color: "primary.contrastText", opacity: 0.9 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "white", animation: "pulse 1.5s infinite" }} />
                    <HeadsetMicIcon sx={{ fontSize: 16 }} />
                    <Typography variant="caption" sx={{ fontWeight: 500 }}>
                      {audioModeSpeaking ? "Speaking..." : recording ? "Listening..." : transcribing ? "Transcribing..." : loading ? "Thinking..." : "Audio mode active"}
                    </Typography>
                    <Button
                      size="small"
                      variant="text"
                      onClick={toggleAudioMode}
                      sx={{ color: "inherit", minWidth: 0, ml: "auto" }}
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
                  <IconButton
                    size="small"
                    onClick={() => {
                      toggleAudioMode();
                      if (!audioMode && !recording) {
                        setTimeout(() => startRecording(), 150);
                      }
                    }}
                    disabled={loading || !activeThread}
                    title={audioMode ? "Turn off audio mode" : "Turn on audio mode (hands-free conversation)"}
                    color={audioMode ? "primary" : "default"}
                    sx={audioMode ? {
                      bgcolor: "primary.main",
                      color: "primary.contrastText",
                      "&:hover": { bgcolor: "primary.dark" },
                      animation: "pulse 2s infinite",
                      "@keyframes pulse": { "0%, 100%": { opacity: 1 }, "50%": { opacity: 0.7 } },
                    } : {}}
                  >
                    <HeadsetMicIcon fontSize="small" />
                  </IconButton>
                  {!audioMode && (
                  <IconButton
                    size="small"
                    onClick={recording ? stopRecording : startRecording}
                    disabled={loading || transcribing || !activeThread}
                    title={recording ? "Stop recording" : transcribing ? "Transcribing..." : "Voice input"}
                    color={recording ? "error" : "default"}
                    sx={recording ? { animation: "pulse 1.5s infinite", "@keyframes pulse": { "0%, 100%": { opacity: 1 }, "50%": { opacity: 0.5 } } } : {}}
                  >
                    {transcribing ? (
                      <CircularProgress size={18} color="inherit" />
                    ) : recording ? (
                      <MicOffIcon fontSize="small" />
                    ) : (
                      <MicIcon fontSize="small" />
                    )}
                  </IconButton>
                  )}
                  <TextField
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    placeholder={recording ? "Listening..." : transcribing ? "Transcribing..." : "Message Nexus..."}
                    disabled={loading}
                    size="small"
                    fullWidth
                    variant="outlined"
                    multiline
                    maxRows={6}
                    inputProps={{ style: { lineHeight: 1.5 } }}
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

/* -------------------------------------------------------------------------- */
/*  ThinkingBlock — shows agent analysis steps (model selection, knowledge     */
/*  retrieval, etc.) in a Gemini/Copilot-style collapsible block              */
/* -------------------------------------------------------------------------- */

interface ThinkingStep {
  step: string;
  detail?: string;
  timestamp: number;
}

const ThinkingBlock = memo(function ThinkingBlock({ steps, autoExpand }: { steps: ThinkingStep[]; autoExpand?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  // Auto-expand when streaming
  useEffect(() => {
    if (autoExpand) setExpanded(true);
  }, [autoExpand]);

  const stepCount = steps.length;

  return (
    <Box sx={{ mb: 1 }}>
      {/* Toggle button */}
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

      {/* Expandable content */}
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
/*  ThoughtsBlock — collapsible thinking steps (collapsed by default)          */
/* -------------------------------------------------------------------------- */

interface ThoughtStep {
  thinking: string | null;
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  toolResults: Array<{ name: string; result: string }>;
  attachments: AttachmentMeta[];
}

/** Pretty-print a tool name: "builtin.web_fetch" → "web_fetch", "mcp.server.tool" → "tool" */
function shortToolName(name: string): string {
  const parts = name.split(".");
  return parts[parts.length - 1];
}

const ThoughtsBlock = memo(function ThoughtsBlock({ thoughts, autoExpand }: { thoughts: ThoughtStep[]; autoExpand?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  // Auto-expand when streaming
  useEffect(() => {
    if (autoExpand) setExpanded(true);
  }, [autoExpand]);

  // Count total tool calls across all steps
  const totalTools = thoughts.reduce((sum, t) => sum + t.toolCalls.length, 0);

  // Collect all unique tool names for the summary chip
  const toolNames = Array.from(new Set(thoughts.flatMap((t) => t.toolCalls.map((tc) => shortToolName(tc.name)))));  const summaryLabel = totalTools === 1
    ? `Used ${toolNames[0]}`
    : `${totalTools} tool calls`;

  return (
    <Box sx={{ mb: 1 }}>
      {/* Toggle button */}
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

      {/* Expandable content */}
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
              {/* Thinking text */}
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

              {/* Tool calls & results */}
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
                    {/* Collapsible args */}
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
                    {/* Tool result */}
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

                    {/* Inline attachments from tool results (e.g., screenshots) */}
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
