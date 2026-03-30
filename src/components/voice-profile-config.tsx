"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface EnrollmentStatus {
  enrolled: boolean;
  enrolledAt: string | null;
}

export function VoiceProfileConfig() {
  const [status, setStatus] = useState<EnrollmentStatus | null>(null);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { toastSnackbar, showToast } = useToast();

  const RECORD_SECONDS = 10;

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/voice/enroll");
      if (res.ok) setStatus(await res.json());
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      showToast("Microphone not available", "error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const candidates = ["audio/wav", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
      const mimeType = candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => { stream.getTracks().forEach((t) => t.stop()); };
      recorder.start(250);
      recorderRef.current = recorder;

      setRecording(true);
      setSecondsLeft(RECORD_SECONDS);

      let elapsed = 0;
      timerRef.current = setInterval(() => {
        elapsed++;
        setSecondsLeft(RECORD_SECONDS - elapsed);
        if (elapsed >= RECORD_SECONDS) {
          stopRecording();
        }
      }, 1000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`Microphone error: ${msg}`, "error");
    }
  }

  function stopRecording() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;

    recorder.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
      recorder.stream?.getTracks().forEach((t) => t.stop());
      await uploadEnrollment(blob);
    };
    recorder.stop();
    recorderRef.current = null;
    setRecording(false);
    setSecondsLeft(0);
  }

  async function uploadEnrollment(blob: Blob) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("audio", blob, "enrollment.webm");
      const res = await fetch("/api/voice/enroll", { method: "POST", body: formData });
      if (res.ok) {
        showToast("Voice profile enrolled successfully", "success");
        await loadStatus();
      } else {
        const err = await res.json().catch(() => ({ error: "Enrollment failed" }));
        showToast(err.error ?? "Enrollment failed", "error");
      }
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete() {
    const res = await fetch("/api/voice/enroll", { method: "DELETE" });
    if (res.ok) {
      showToast("Voice profile removed", "success");
      setDeleteConfirm(false);
      await loadStatus();
    } else {
      showToast("Failed to remove voice profile", "error");
    }
  }

  return (
    <div className="space-y-6">
      {toastSnackbar}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Voice Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Enroll your voice so a shared ESP32 device can identify you and route conversations
            to your account. Speak naturally for {RECORD_SECONDS} seconds when recording.
          </p>

          {status === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : status.enrolled ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
                <span className="text-sm font-medium">Voice profile enrolled</span>
                {status.enrolledAt && (
                  <span className="text-xs text-muted-foreground">
                    since {new Date(status.enrolledAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                You can re-enroll to update your voice profile, or delete it to stop speaker identification.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={startRecording}
                  disabled={recording || uploading}
                >
                  {recording ? `Recording… ${secondsLeft}s` : uploading ? "Processing…" : "Re-enroll"}
                </Button>
                {recording && (
                  <Button size="sm" variant="ghost" onClick={stopRecording}>
                    Stop Early
                  </Button>
                )}
                {!deleteConfirm ? (
                  <Button size="sm" variant="outline" onClick={() => setDeleteConfirm(true)}>
                    Remove Profile
                  </Button>
                ) : (
                  <>
                    <Button size="sm" variant="destructive" onClick={handleDelete}>
                      Confirm Remove
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleteConfirm(false)}>
                      Cancel
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-gray-400" />
                <span className="text-sm font-medium">Not enrolled</span>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={startRecording}
                  disabled={recording || uploading}
                >
                  {recording ? `Recording… ${secondsLeft}s` : uploading ? "Processing…" : "Start Recording"}
                </Button>
                {recording && (
                  <Button size="sm" variant="ghost" onClick={stopRecording}>
                    Stop Early
                  </Button>
                )}
              </div>
            </div>
          )}

          {(recording || uploading) && (
            <div className="rounded bg-muted px-3 py-2 text-xs text-muted-foreground">
              {recording
                ? `🎙️ Recording… speak naturally. Stops automatically in ${secondsLeft}s.`
                : "Processing voice enrollment…"}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
