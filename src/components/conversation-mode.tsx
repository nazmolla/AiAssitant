"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Chip from "@mui/material/Chip";
import Fade from "@mui/material/Fade";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import HeadsetMicIcon from "@mui/icons-material/HeadsetMic";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import CloseIcon from "@mui/icons-material/Close";

/* ─── Types ─────────────────────────────────────────────────────────── */

type ConvState =
  | "idle"         // Not started
  | "listening"    // Recording + VAD active
  | "processing"   // STT transcription in progress
  | "thinking"     // Waiting for LLM response
  | "speaking"     // Playing TTS audio
  | "error";       // Recoverable error

interface TranscriptEntry {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
}

/* ─── Constants ─────────────────────────────────────────────────────── */

const SILENCE_THRESHOLD = 0.015; // RMS amplitude below which we consider silence
const SILENCE_DURATION_MS = 1800; // 1.8s of continuous silence = end of speech
const MIN_SPEECH_DURATION_MS = 500; // need at least 0.5s of speech to trigger processing
const ANALYSER_FFT_SIZE = 2048;
const ANALYSER_POLL_MS = 100; // check audio levels every 100ms
const TTS_VOICES = ["alloy", "ash", "coral", "echo", "fable", "onyx", "nova", "sage", "shimmer"] as const;

/* ─── Utility: sanitize markdown from LLM response for TTS ───────── */

function sanitizeForTts(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "") // remove code blocks
    .replace(/`[^`]+`/g, "")        // remove inline code
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // markdown links → text
    .replace(/[*_~#>|]/g, "")       // remove markdown symbols
    .replace(/\n{2,}/g, ". ")       // double newlines → period
    .replace(/\n/g, " ")            // single newlines → space
    .replace(/\s{2,}/g, " ")        // collapse whitespace
    .trim();
}

/* ═══════════════════════════════════════════════════════════════════ */
/*  ConversationMode Component                                        */
/* ═══════════════════════════════════════════════════════════════════ */

export function ConversationMode() {
  /* ─── State ────────────────────────────────────────────────────── */
  const [state, setState] = useState<ConvState>("idle");
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [currentText, setCurrentText] = useState(""); // streaming LLM text
  const [errorMsg, setErrorMsg] = useState("");
  const [audioLevel, setAudioLevel] = useState(0); // 0-1 for visual feedback
  const [voice, setVoice] = useState<string>("nova");
  const [autoListen, setAutoListen] = useState(true);

  /* ─── Refs ─────────────────────────────────────────────────────── */
  const stateRef = useRef<ConvState>("idle");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const speechDetectedRef = useRef(false);
  const speechStartRef = useRef<number | null>(null);
  const vadIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const autoListenRef = useRef(true);
  const conversationHistoryRef = useRef<Array<{ role: string; content: string }>>([]); // in-memory LLM history

  // Keep refs in sync with state
  useEffect(() => { stateRef.current = state; }, [state]);
  useEffect(() => { autoListenRef.current = autoListen; }, [autoListen]);

  // Load voice preference
  useEffect(() => {
    try {
      const stored = localStorage.getItem("nexus_tts_voice");
      if (stored && TTS_VOICES.includes(stored as typeof TTS_VOICES[number])) {
        setVoice(stored);
      }
    } catch { /* noop */ }
  }, []);

  // Auto-scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView?.({ behavior: "smooth" });
  }, [transcript, currentText]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopEverything();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── Voice Activity Detection (VAD) ───────────────────────────── */

  function startVad() {
    if (!analyserRef.current) return;

    const analyser = analyserRef.current;
    const dataArray = new Float32Array(analyser.fftSize);

    silenceStartRef.current = null;
    speechDetectedRef.current = false;
    speechStartRef.current = null;

    vadIntervalRef.current = setInterval(() => {
      if (stateRef.current !== "listening") return;

      analyser.getFloatTimeDomainData(dataArray);

      // Calculate RMS
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i] * dataArray[i];
      }
      const rms = Math.sqrt(sum / dataArray.length);
      setAudioLevel(Math.min(1, rms * 10)); // normalize for visual

      const now = Date.now();

      if (rms > SILENCE_THRESHOLD) {
        // Speech detected
        silenceStartRef.current = null;
        if (!speechDetectedRef.current) {
          speechDetectedRef.current = true;
          speechStartRef.current = now;
        }
      } else {
        // Silence
        if (speechDetectedRef.current && silenceStartRef.current === null) {
          silenceStartRef.current = now;
        }

        // Check if silence has lasted long enough after speech
        if (
          speechDetectedRef.current &&
          silenceStartRef.current !== null &&
          now - silenceStartRef.current >= SILENCE_DURATION_MS
        ) {
          // Check minimum speech duration
          const speechDuration = speechStartRef.current
            ? (silenceStartRef.current - speechStartRef.current)
            : 0;
          if (speechDuration >= MIN_SPEECH_DURATION_MS) {
            // End of speech detected — stop recording
            stopRecordingForProcessing();
          }
        }
      }
    }, ANALYSER_POLL_MS);
  }

  function stopVad() {
    if (vadIntervalRef.current) {
      clearInterval(vadIntervalRef.current);
      vadIntervalRef.current = null;
    }
    setAudioLevel(0);
  }

  /* ─── Recording ────────────────────────────────────────────────── */

  async function startListening() {
    if (stateRef.current !== "idle" && stateRef.current !== "error") return;

    // Check mic availability
    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMsg("Microphone access not available. Requires HTTPS or localhost.");
      setState("error");
      return;
    }

    try {
      setState("listening");
      setErrorMsg("");

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up AudioContext + AnalyserNode for VAD
      const audioCtx = new AudioContext();
      audioContextRef.current = audioCtx;
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = ANALYSER_FFT_SIZE;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Set up MediaRecorder
      const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ];
      const mimeType = candidates.find((m) => MediaRecorder.isTypeSupported(m)) || "";
      const recorderOpts: MediaRecorderOptions = mimeType ? { mimeType } : {};
      const recorder = new MediaRecorder(stream, recorderOpts);
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        // Don't stop stream tracks here — we reuse them if auto-listening
        // The blob is processed in stopRecordingForProcessing
      };

      mediaRecorderRef.current = recorder;
      recorder.start(250); // collect chunks every 250ms

      // Start VAD
      startVad();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Microphone error: ${msg}`);
      setState("error");
      cleanupAudio();
    }
  }

  function stopRecordingForProcessing() {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state === "inactive") return;

    stopVad();
    setState("processing");

    const recorder = mediaRecorderRef.current;
    const actualMime = recorder.mimeType;

    // Create a new onstop handler that processes the audio
    recorder.onstop = async () => {
      const blob = new Blob(audioChunksRef.current, { type: actualMime });
      audioChunksRef.current = [];

      if (blob.size < 100) {
        // Too short — go back to listening
        if (autoListenRef.current && stateRef.current === "processing") {
          restartListening();
        } else {
          setState("idle");
          cleanupAudio();
        }
        return;
      }

      await processAudio(blob, actualMime);
    };

    recorder.stop();
    // Stop tracks since we'll get fresh ones on restart
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  }

  /* ─── Process audio: STT → LLM (with tools) → TTS ──────────────── */

  async function processAudio(blob: Blob, mimeType: string) {
    try {
      // 1. Transcribe (STT) — with 30s timeout
      setState("processing");
      const ext = mimeType.includes("mp4") || mimeType.includes("m4a") ? "mp4"
        : mimeType.includes("ogg") ? "ogg" : "webm";
      const formData = new FormData();
      formData.append("audio", blob, `recording.${ext}`);

      const sttAbort = new AbortController();
      const sttTimeout = setTimeout(() => sttAbort.abort(), 30_000);
      let sttRes: Response;
      try {
        sttRes = await fetch("/api/audio/transcribe", {
          method: "POST",
          body: formData,
          signal: sttAbort.signal,
        });
      } finally {
        clearTimeout(sttTimeout);
      }
      const sttData = await sttRes.json();

      if (!sttRes.ok || !sttData.text?.trim()) {
        // No speech detected — go back to listening
        if (autoListenRef.current) {
          restartListening();
        } else {
          setState("idle");
        }
        return;
      }

      const userText = sttData.text.trim();
      setTranscript((prev) => [...prev, { role: "user", text: userText, timestamp: Date.now() }]);

      // 2. Send to LLM via lightweight conversation endpoint (with tools)
      setState("thinking");
      setCurrentText("");

      const abort = new AbortController();
      abortRef.current = abort;

      // Build history from in-memory ref (no thread/DB needed)
      const history = conversationHistoryRef.current;

      const chatRes = await fetch("/api/conversation/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText, history }),
        signal: abort.signal,
      });

      if (!chatRes.ok) {
        throw new Error(`LLM request failed: ${chatRes.status}`);
      }

      // 3. Consume SSE stream (handles token, tool_call, tool_result, done, error)
      const reader = chatRes.body?.getReader();
      if (!reader) throw new Error("No response stream");
      const decoder = new TextDecoder();
      let buffer = "";
      let fullResponse = "";
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
              if (currentEvent === "token") {
                const token = data as string;
                fullResponse += token;
                setCurrentText((prev) => prev + token);
              } else if (currentEvent === "tool_call") {
                // Tool is being called — show it as a status
                setCurrentText((prev) => prev + (prev ? "\n" : "") + `⚙️ Using ${data.name}...`);
              } else if (currentEvent === "tool_result") {
                // Clear tool call indicator — LLM will process next
                setCurrentText("");
                fullResponse = ""; // reset — LLM will generate a new response after tool results
              } else if (currentEvent === "done") {
                if (data.content && !fullResponse) {
                  fullResponse = data.content;
                }
              } else if (currentEvent === "error") {
                throw new Error(data.error || "LLM error");
              }
            } catch (e) {
              if (e instanceof Error && e.message.includes("LLM error")) throw e;
              // Ignore malformed JSON
            }
            currentEvent = "";
          }
        }
      }

      if (!fullResponse.trim()) {
        throw new Error("Empty response from LLM");
      }

      // Update in-memory conversation history
      conversationHistoryRef.current = [
        ...history,
        { role: "user", content: userText },
        { role: "assistant", content: fullResponse },
      ].slice(-30); // cap at 30 messages

      // Add assistant response to transcript
      setTranscript((prev) => [...prev, { role: "assistant", text: fullResponse, timestamp: Date.now() }]);
      setCurrentText("");

      // 4. TTS — speak the response (with 30s timeout)
      const ttsText = sanitizeForTts(fullResponse);
      if (ttsText) {
        setState("speaking");
        await playTts(ttsText);
      }

      // 5. Auto-listen again
      if (autoListenRef.current && stateRef.current === "speaking") {
        setTimeout(() => {
          if (autoListenRef.current && (stateRef.current === "speaking" || stateRef.current === "idle")) {
            restartListening();
          }
        }, 400);
      } else {
        setState("idle");
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setState("idle");
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setState("error");
    }
  }

  /* ─── TTS playback ────────────────────────────────────────────── */

  async function playTts(text: string): Promise<void> {
    return new Promise<void>(async (resolve) => {
      try {
        const res = await fetch("/api/audio/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, voice }),
        });

        if (!res.ok) {
          resolve();
          return;
        }

        const audioBlob = await res.blob();
        const url = URL.createObjectURL(audioBlob);
        const audio = new Audio(url);
        ttsAudioRef.current = audio;

        audio.onended = () => {
          URL.revokeObjectURL(url);
          ttsAudioRef.current = null;
          resolve();
        };
        audio.onerror = () => {
          URL.revokeObjectURL(url);
          ttsAudioRef.current = null;
          resolve();
        };

        await audio.play();
      } catch {
        resolve();
      }
    });
  }

  /* ─── Restart listening (auto-loop) ────────────────────────────── */

  function restartListening() {
    cleanupAudio();
    // Short delay before restarting to prevent audio feedback
    setTimeout(() => {
      if (autoListenRef.current) {
        startListening();
      } else {
        setState("idle");
      }
    }, 200);
  }

  /* ─── Stop everything ──────────────────────────────────────────── */

  function stopEverything() {
    stopVad();
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current.currentTime = 0;
      ttsAudioRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    cleanupAudio();
    setState("idle");
    setCurrentText("");
    setAudioLevel(0);
  }

  function cleanupAudio() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
  }

  /* ─── Computed UI values ───────────────────────────────────────── */

  const isActive = state !== "idle" && state !== "error";

  const statusLabel: Record<ConvState, string> = {
    idle: "Ready to talk",
    listening: "Listening...",
    processing: "Transcribing...",
    thinking: "Thinking...",
    speaking: "Speaking...",
    error: "Error",
  };

  const statusColor: Record<ConvState, string> = {
    idle: "text.secondary",
    listening: "success.main",
    processing: "warning.main",
    thinking: "info.main",
    speaking: "primary.main",
    error: "error.main",
  };

  /* ─── Render ───────────────────────────────────────────────────── */

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        bgcolor: "background.default",
        position: "relative",
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          py: 1,
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <HeadsetMicIcon color="primary" />
          <Typography variant="subtitle1" fontWeight={600}>
            Conversation Mode
          </Typography>
          <Chip
            size="small"
            label={statusLabel[state]}
            sx={{
              fontSize: "0.7rem",
              height: 22,
              bgcolor: state === "idle" ? "transparent" : undefined,
              color: statusColor[state],
              borderColor: statusColor[state],
            }}
            variant="outlined"
          />
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <FormControl size="small" sx={{ minWidth: 100 }}>
            <InputLabel sx={{ fontSize: "0.75rem" }}>Voice</InputLabel>
            <Select
              value={voice}
              label="Voice"
              onChange={(e) => {
                setVoice(e.target.value);
                try { localStorage.setItem("nexus_tts_voice", e.target.value); } catch {}
              }}
              sx={{ fontSize: "0.75rem", height: 32 }}
            >
              {TTS_VOICES.map((v) => (
                <MenuItem key={v} value={v} sx={{ fontSize: "0.75rem" }}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Chip
            size="small"
            label={autoListen ? "Auto" : "Manual"}
            onClick={() => setAutoListen(!autoListen)}
            color={autoListen ? "primary" : "default"}
            variant={autoListen ? "filled" : "outlined"}
            sx={{ fontSize: "0.7rem", height: 22, cursor: "pointer" }}
            title={autoListen ? "Auto-listen after response (click to disable)" : "Manual mode (click for auto-listen)"}
          />
        </Box>
      </Box>

      {/* Transcript area */}
      <Box
        sx={{
          flex: 1,
          overflowY: "auto",
          px: { xs: 2, sm: 4 },
          py: 2,
          display: "flex",
          flexDirection: "column",
          gap: 1.5,
        }}
      >
        {transcript.length === 0 && state === "idle" && (
          <Box
            sx={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 2,
              opacity: 0.6,
            }}
          >
            <HeadsetMicIcon sx={{ fontSize: 64, color: "text.secondary" }} />
            <Typography variant="h6" color="text.secondary">
              Voice Conversation
            </Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center" maxWidth={400}>
              Start talking and Nexus will listen, respond, and keep the conversation flowing naturally.
              Speech is detected automatically — just speak and pause when you&apos;re done.
            </Typography>
          </Box>
        )}

        {transcript.map((entry, i) => (
          <Fade in key={i}>
            <Box
              sx={{
                display: "flex",
                justifyContent: entry.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "85%",
                alignSelf: entry.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              <Box
                sx={{
                  px: 2,
                  py: 1,
                  borderRadius: 2.5,
                  bgcolor: entry.role === "user" ? "primary.main" : "background.paper",
                  color: entry.role === "user" ? "primary.contrastText" : "text.primary",
                  border: entry.role === "assistant" ? 1 : 0,
                  borderColor: "divider",
                  boxShadow: entry.role === "assistant" ? 1 : 0,
                }}
              >
                <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.25, fontSize: "0.65rem" }}>
                  {entry.role === "user" ? "You" : "Nexus"}
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                  {entry.text}
                </Typography>
              </Box>
            </Box>
          </Fade>
        ))}

        {/* Streaming LLM response */}
        {currentText && (
          <Fade in>
            <Box sx={{ maxWidth: "85%", alignSelf: "flex-start" }}>
              <Box
                sx={{
                  px: 2,
                  py: 1,
                  borderRadius: 2.5,
                  bgcolor: "background.paper",
                  border: 1,
                  borderColor: "divider",
                  boxShadow: 1,
                }}
              >
                <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 0.25, fontSize: "0.65rem" }}>
                  Nexus
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}>
                  {currentText}
                  <Box
                    component="span"
                    sx={{
                      display: "inline-block",
                      width: 6,
                      height: 14,
                      bgcolor: "primary.main",
                      ml: 0.5,
                      animation: "blink 1s infinite",
                      "@keyframes blink": { "0%, 100%": { opacity: 1 }, "50%": { opacity: 0 } },
                    }}
                  />
                </Typography>
              </Box>
            </Box>
          </Fade>
        )}

        {/* Error message */}
        {state === "error" && errorMsg && (
          <Box sx={{ mx: "auto", mt: 2 }}>
            <Chip
              label={errorMsg}
              color="error"
              variant="outlined"
              size="small"
              onDelete={() => { setErrorMsg(""); setState("idle"); }}
            />
          </Box>
        )}

        <div ref={transcriptEndRef} />
      </Box>

      {/* Bottom control area */}
      <Box
        sx={{
          borderTop: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
          px: 2,
          py: 2,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 1.5,
        }}
      >
        {/* Audio level visualizer */}
        {state === "listening" && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 0.5,
              height: 32,
              width: "100%",
              maxWidth: 200,
            }}
          >
            {[...Array(12)].map((_, i) => {
              const barLevel = Math.max(
                0.15,
                audioLevel * (0.5 + 0.5 * Math.sin((i / 12) * Math.PI + Date.now() / 200))
              );
              return (
                <Box
                  key={i}
                  sx={{
                    width: 4,
                    height: `${barLevel * 100}%`,
                    minHeight: 4,
                    maxHeight: 32,
                    bgcolor: "primary.main",
                    borderRadius: 1,
                    transition: "height 0.1s ease",
                  }}
                />
              );
            })}
          </Box>
        )}

        {/* Processing indicator */}
        {(state === "processing" || state === "thinking") && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <CircularProgress size={20} />
            <Typography variant="caption" color="text.secondary">
              {statusLabel[state]}
            </Typography>
          </Box>
        )}

        {/* Speaking indicator */}
        {state === "speaking" && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <VolumeUpIcon color="primary" sx={{ animation: "pulse 1.5s infinite", "@keyframes pulse": { "0%, 100%": { opacity: 1 }, "50%": { opacity: 0.4 } } }} />
            <Typography variant="caption" color="primary">
              Speaking...
            </Typography>
          </Box>
        )}

        {/* Main control button */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          {!isActive ? (
            <IconButton
              onClick={startListening}
              sx={{
                width: 72,
                height: 72,
                bgcolor: "primary.main",
                color: "primary.contrastText",
                "&:hover": { bgcolor: "primary.dark" },
                boxShadow: 3,
                transition: "all 0.2s",
              }}
            >
              <MicIcon sx={{ fontSize: 36 }} />
            </IconButton>
          ) : (
            <IconButton
              onClick={stopEverything}
              sx={{
                width: 72,
                height: 72,
                bgcolor: "error.main",
                color: "error.contrastText",
                "&:hover": { bgcolor: "error.dark" },
                boxShadow: 3,
                animation: state === "listening" ? "pulse-ring 2s infinite" : undefined,
                "@keyframes pulse-ring": {
                  "0%": { boxShadow: "0 0 0 0 rgba(244, 67, 54, 0.4)" },
                  "70%": { boxShadow: "0 0 0 15px rgba(244, 67, 54, 0)" },
                  "100%": { boxShadow: "0 0 0 0 rgba(244, 67, 54, 0)" },
                },
              }}
            >
              <StopCircleIcon sx={{ fontSize: 36 }} />
            </IconButton>
          )}
        </Box>

        <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.65rem" }}>
          {!isActive
            ? "Tap the microphone to start a conversation"
            : state === "listening"
              ? "Speak naturally — Nexus will respond when you pause"
              : "Tap stop to end the conversation"
          }
        </Typography>

        {/* Clear transcript */}
        {transcript.length > 0 && !isActive && (
          <Button
            size="small"
            variant="text"
            color="inherit"
            onClick={() => {
              setTranscript([]);
              conversationHistoryRef.current = [];
            }}
            sx={{ fontSize: "0.7rem", opacity: 0.6 }}
          >
            Clear conversation
          </Button>
        )}
      </Box>
    </Box>
  );
}
