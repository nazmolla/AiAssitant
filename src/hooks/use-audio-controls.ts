"use client";

import { useState, useEffect, useRef } from "react";

export interface UseAudioControlsOptions {
  onTranscription: (text: string) => void;
  sendMessageRef: React.MutableRefObject<(() => void) | null>;
}

export interface UseAudioControlsReturn {
  recording: boolean;
  transcribing: boolean;
  playingTtsId: number | null;
  audioMode: boolean;
  audioModeRef: React.MutableRefObject<boolean>;
  audioModeSpeaking: React.MutableRefObject<boolean>;
  audioModeTtsQueue: React.MutableRefObject<string>;
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  playTts: (messageId: number, text: string) => Promise<void>;
  toggleAudioMode: () => void;
  audioModePlayTts: (text: string) => Promise<void>;
}

export function useAudioControls({
  onTranscription,
  sendMessageRef,
}: UseAudioControlsOptions): UseAudioControlsReturn {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const [playingTtsId, setPlayingTtsId] = useState<number | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);

  const [audioMode, setAudioMode] = useState(false);
  const audioModeRef = useRef(false);
  const audioModeTtsQueue = useRef<string>("");
  const audioModeSpeaking = useRef(false);
  const audioModeProcessing = useRef(false);
  const audioModePendingText = useRef<string | null>(null);

  // ── Audio Recording (Speech-to-Text) ──────────────────────────────

  async function startRecording() {
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

      const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ];
      const mimeType = candidates.find((m) => MediaRecorder.isTypeSupported(m)) || "";
      const recorderOptions: MediaRecorderOptions = mimeType ? { mimeType } : {};
      const recorder = new MediaRecorder(stream, recorderOptions);
      const actualMime = recorder.mimeType;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: actualMime });
        if (blob.size < 100) return;

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
                audioModePendingText.current = data.text;
              }
              onTranscription(data.text);
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

      recorder.start(250);
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

  // ── Text-to-Speech ────────────────────────────────────────────────

  async function playTts(messageId: number, text: string) {
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
      if (playingTtsId === messageId) {
        setPlayingTtsId(null);
        return;
      }
    }

    setPlayingTtsId(messageId);
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

  // ── Audio Mode — Continuous Voice Conversation ────────────────────

  function toggleAudioMode() {
    const next = !audioMode;
    setAudioMode(next);
    audioModeRef.current = next;
    if (!next) {
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

  // Auto-send transcribed text in audio mode
  useEffect(() => {
    if (!transcribing && audioModeRef.current && audioModePendingText.current) {
      audioModePendingText.current = null;
      setTimeout(() => {
        sendMessageRef.current?.();
      }, 50);
    }
  }, [transcribing, sendMessageRef]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (ttsAudioRef.current) {
        ttsAudioRef.current.pause();
        ttsAudioRef.current = null;
      }
      audioModeRef.current = false;
    };
  }, []);

  return {
    recording,
    transcribing,
    playingTtsId,
    audioMode,
    audioModeRef,
    audioModeSpeaking,
    audioModeTtsQueue,
    startRecording,
    stopRecording,
    playTts,
    toggleAudioMode,
    audioModePlayTts,
  };
}
