"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export interface UseScreenShareOptions {
  onError?: (msg: string) => void;
}

export interface UseScreenShareReturn {
  screenSharing: boolean;
  screenShareEnabled: boolean;
  latestFrameRef: React.MutableRefObject<string | null>;
  frameImgRef: React.MutableRefObject<HTMLImageElement | null>;
  captureFrame: () => string | null;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
}

export function useScreenShare({ onError }: UseScreenShareOptions = {}): UseScreenShareReturn {
  const notify = onError ?? ((msg: string) => console.error("[useScreenShare]", msg));
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [screenSharing, setScreenSharing] = useState(false);
  const [screenShareEnabled, setScreenShareEnabled] = useState(true);
  const latestFrameRef = useRef<string | null>(null);
  const frameImgRef = useRef<HTMLImageElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  function stopScreenShareInternal() {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }
    setScreenStream((prev) => {
      if (prev) prev.getTracks().forEach((t) => t.stop());
      return null;
    });
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current = null;
    }
    setScreenSharing(false);
    latestFrameRef.current = null;
  }

  async function startScreenShare() {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      notify(
        "Screen sharing is not available. This feature requires a secure context (HTTPS or localhost). " +
        "If you're accessing via HTTP over a network, enable HTTPS or use localhost."
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { max: 1 } },
        audio: false,
      });

      const video = document.createElement("video");
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      videoRef.current = video;

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
        stopScreenShareInternal();
      });
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "NotAllowedError") return;
      console.error("Screen share failed:", err);
      notify("Screen sharing failed: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  // Fetch screen sharing preference
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
    function onVisChange() {
      if (document.visibilityState === "visible") fetchScreenSharePref();
    }
    document.addEventListener("visibilitychange", onVisChange);
    return () => document.removeEventListener("visibilitychange", onVisChange);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
      if (screenStream) screenStream.getTracks().forEach((t) => t.stop());
    };
  }, [screenStream]);

  return {
    screenSharing,
    screenShareEnabled,
    latestFrameRef,
    frameImgRef,
    captureFrame,
    startScreenShare,
    stopScreenShare: stopScreenShareInternal,
  };
}
