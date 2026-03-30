/**
 * Nexus LiveKit Agent Worker
 *
 * Long-running process that connects to a self-hosted LiveKit server and
 * acts as an AI participant in voice rooms. One room = one Nexus thread.
 *
 * Pipeline per room:
 *   ESP32 mic (Opus/WebRTC via LiveKit)
 *     → server-side VAD (energy/RMS threshold, 1.2s silence window)
 *     → Whisper STT  (reuses src/lib/audio.ts via HTTP)
 *     → persist user message to thread
 *     → runAgentLoop (full loop: tools, knowledge, profile context)
 *     → persist assistant message
 *     → OpenAI TTS → PCM audio
 *     → publish back to LiveKit room
 *     → ESP32 speaker
 *
 * Speaker identification (Phase 2):
 *   First utterance per session is also sent to src/lib/voice-id.ts.
 *   If a confident match is found, the active userId is switched to the
 *   identified speaker before the agent loop runs.
 *
 * Usage:
 *   npx ts-node --project tsconfig.json scripts/livekit-agent.ts
 *   (or compiled: node dist/scripts/livekit-agent.js)
 *
 * Required env vars:
 *   LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
 * Optional:
 *   NEXUS_BASE_URL (default: http://localhost:3000)
 */

import "dotenv/config";
import {
  Room,
  RoomEvent,
  RemoteTrack,
  RemoteTrackPublication,
  RemoteParticipant,
  Track,
  AudioFrame,
  VideoPresets,
} from "@livekit/rtc-node";
import { AccessToken } from "livekit-server-sdk";
import { runAgentLoop } from "@/lib/agent/loop";
import { getThread, createThread } from "@/lib/db/thread-queries";
import { identifySpeaker } from "@/lib/voice-id";
import { initializeDatabase } from "@/lib/db/init";

// ─── Config ─────────────────────────────────────────────────────────────────

const LIVEKIT_URL = process.env.LIVEKIT_URL ?? "";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY ?? "";
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET ?? "";
const NEXUS_BASE_URL = process.env.NEXUS_BASE_URL ?? "http://localhost:3000";

// VAD parameters
const VAD_SILENCE_THRESHOLD = 0.015; // RMS amplitude
const VAD_SILENCE_DURATION_MS = 1200; // 1.2s silence = end of utterance
const VAD_MIN_SPEECH_MS = 400; // minimum speech duration before processing
const SAMPLE_RATE = 16000; // Hz (ESP32 SDK default)
const CHANNELS = 1; // mono

// ─── Types ───────────────────────────────────────────────────────────────────

interface RoomSession {
  room: Room;
  threadId: string;
  userId: string;
  speakerIdentified: boolean;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    console.error("[livekit-agent] Missing LIVEKIT_URL, LIVEKIT_API_KEY, or LIVEKIT_API_SECRET");
    process.exit(1);
  }

  // Initialize the Nexus DB so all queries work
  initializeDatabase();
  console.log("[livekit-agent] Database initialized");

  // The agent connects to LiveKit as a server-side participant watching for rooms.
  // For each room that has a participant, the agent joins and starts the pipeline.
  // This is done by polling the LiveKit Room Service API (simpler than webhooks
  // for self-hosted single-server deployments).
  await watchForRooms();
}

/**
 * Poll the LiveKit Room Service for rooms that need an agent participant.
 * When a new room appears (ESP32 joined), the agent joins it.
 */
async function watchForRooms() {
  const { RoomServiceClient } = await import("livekit-server-sdk");
  const roomService = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  const agentRooms = new Set<string>();

  console.log("[livekit-agent] Watching for rooms on", LIVEKIT_URL);

  // Poll every 2 seconds
  setInterval(async () => {
    try {
      const rooms = await roomService.listRooms();
      for (const room of rooms) {
        if (!agentRooms.has(room.name)) {
          // Check if there are participants (the ESP32 device)
          const participants = await roomService.listParticipants(room.name);
          const hasDevice = participants.some((p) => p.identity.startsWith("device-"));
          if (hasDevice) {
            agentRooms.add(room.name);
            joinRoom(room.name).catch((err) => {
              console.error("[livekit-agent] Error in room", room.name, err);
              agentRooms.delete(room.name);
            });
          }
        }
      }

      // Clean up departed rooms
      for (const roomName of agentRooms) {
        const exists = rooms.some((r) => r.name === roomName);
        if (!exists) agentRooms.delete(roomName);
      }
    } catch (err) {
      console.error("[livekit-agent] Room watch error:", err);
    }
  }, 2000);
}

/**
 * Join a LiveKit room as the agent participant and run the full audio pipeline.
 * room.name === threadId (the canonical mapping).
 */
async function joinRoom(roomName: string) {
  // roomName === threadId
  const threadId = roomName;
  const thread = getThread(threadId);
  if (!thread) {
    console.warn("[livekit-agent] Thread not found for room:", roomName);
    return;
  }
  const userId = thread.user_id ?? "";

  console.log(`[livekit-agent] Joining room ${roomName} for user ${userId}`);

  // Generate agent JWT
  const token = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: "nexus-agent",
    ttl: 86400, // 24h
  });
  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
  });

  const room = new Room();
  const session: RoomSession = {
    room,
    threadId,
    userId,
    speakerIdentified: false,
  };

  // Track subscriptions
  room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
    if (track.kind === Track.Kind.Audio) {
      console.log(`[livekit-agent] Subscribed to audio from ${participant.identity}`);
      handleAudioTrack(track, session);
    }
  });

  room.on(RoomEvent.ParticipantDisconnected, (participant: RemoteParticipant) => {
    console.log(`[livekit-agent] Participant disconnected: ${participant.identity}`);
  });

  room.on(RoomEvent.Disconnected, () => {
    console.log(`[livekit-agent] Disconnected from room ${roomName}`);
  });

  await room.connect(LIVEKIT_URL, await token.toJwt(), {
    autoSubscribe: true,
    dynacast: false,
  });

  console.log(`[livekit-agent] Connected to room ${roomName}`);
}

/**
 * Process an audio track from the ESP32:
 * VAD → buffer utterances → STT → speaker ID → runAgentLoop → TTS → publish
 */
async function handleAudioTrack(track: RemoteTrack, session: RoomSession) {
  const pcmChunks: Buffer[] = [];
  let speechActive = false;
  let silenceStart: number | null = null;
  let speechStart: number | null = null;
  let processing = false;

  // AudioFrame handler — frames arrive as raw PCM at 16kHz mono
  track.on("audioFrameReceived", async (frame: AudioFrame) => {
    if (processing) return; // drop frames while processing to avoid backlog

    // Convert Int16 samples to Float32 for RMS calculation
    const samples = new Int16Array(frame.data.buffer);
    let sumSq = 0;
    for (let i = 0; i < samples.length; i++) {
      const f = samples[i] / 32768;
      sumSq += f * f;
    }
    const rms = Math.sqrt(sumSq / samples.length);
    const now = Date.now();

    if (rms > VAD_SILENCE_THRESHOLD) {
      // Speech detected
      silenceStart = null;
      if (!speechActive) {
        speechActive = true;
        speechStart = now;
        pcmChunks.length = 0;
      }
      pcmChunks.push(Buffer.from(frame.data.buffer));
    } else if (speechActive) {
      // Silence after speech
      pcmChunks.push(Buffer.from(frame.data.buffer)); // include trailing silence
      if (silenceStart === null) silenceStart = now;

      const speechDuration = speechStart ? silenceStart - speechStart : 0;
      const silenceDuration = now - silenceStart;

      if (silenceDuration >= VAD_SILENCE_DURATION_MS && speechDuration >= VAD_MIN_SPEECH_MS) {
        // End of utterance — process
        speechActive = false;
        silenceStart = null;
        speechStart = null;
        processing = true;

        const utteranceBuffer = Buffer.concat(pcmChunks);
        pcmChunks.length = 0;

        try {
          await processUtterance(utteranceBuffer, session);
        } catch (err) {
          console.error("[livekit-agent] Utterance processing error:", err);
        } finally {
          processing = false;
        }
      }
    }
  });
}

/**
 * Full pipeline for one utterance:
 * PCM buffer → STT → (speaker ID on first) → runAgentLoop → TTS → publish
 */
async function processUtterance(pcmBuffer: Buffer, session: RoomSession) {
  // 1. STT via Nexus API (Whisper)
  const transcript = await transcribeAudio(pcmBuffer);
  if (!transcript?.trim()) {
    console.log("[livekit-agent] Empty transcript — skipping");
    return;
  }
  console.log(`[livekit-agent] [${session.threadId}] User: ${transcript}`);

  // 2. Speaker identification (first utterance only)
  let activeUserId = session.userId;
  if (!session.speakerIdentified) {
    session.speakerIdentified = true;
    try {
      const identified = await identifySpeaker(pcmBuffer, SAMPLE_RATE);
      if (identified) {
        console.log(`[livekit-agent] Speaker identified: ${identified}`);
        activeUserId = identified;
        session.userId = identified;
      }
    } catch (err) {
      console.warn("[livekit-agent] Speaker ID failed (using device owner):", err);
    }
  }

  // 3. Run full agent loop (persists to thread)
  let agentResponse = "";
  await runAgentLoop(
    session.threadId,
    transcript,
    undefined,
    undefined,
    undefined,
    activeUserId,
    undefined,
    undefined,
    async (token) => { agentResponse += token; }
  );

  if (!agentResponse.trim()) {
    console.log("[livekit-agent] Empty agent response");
    return;
  }
  console.log(`[livekit-agent] [${session.threadId}] Agent: ${agentResponse.slice(0, 100)}...`);

  // 4. TTS → PCM → publish to room
  try {
    const audioBuffer = await synthesizeSpeech(agentResponse);
    if (audioBuffer) {
      await publishAudio(session.room, audioBuffer);
    }
  } catch (err) {
    console.error("[livekit-agent] TTS/publish error:", err);
  }
}

/**
 * Send PCM audio to Nexus STT API (Whisper) and return the transcript.
 */
async function transcribeAudio(pcmBuffer: Buffer): Promise<string | null> {
  try {
    // Wrap raw PCM in a WAV header so Whisper can parse it
    const wavBuffer = pcmToWav(pcmBuffer, SAMPLE_RATE, CHANNELS, 16);
    const formData = new FormData();
    const blob = new Blob([wavBuffer], { type: "audio/wav" });
    formData.append("audio", blob, "utterance.wav");

    const res = await fetch(`${NEXUS_BASE_URL}/api/audio/transcribe`, {
      method: "POST",
      body: formData,
    });
    if (!res.ok) return null;
    const data = await res.json() as { text?: string };
    return data.text ?? null;
  } catch (err) {
    console.error("[livekit-agent] STT error:", err);
    return null;
  }
}

/**
 * Synthesize speech via Nexus TTS API. Returns raw PCM buffer (24kHz, 16-bit, mono).
 */
async function synthesizeSpeech(text: string): Promise<Buffer | null> {
  // Sanitize markdown for TTS
  const clean = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]+`/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~#>|]/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .trim()
    .slice(0, 4000);

  if (!clean) return null;

  try {
    const res = await fetch(`${NEXUS_BASE_URL}/api/audio/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean, format: "pcm" }),
    });
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.error("[livekit-agent] TTS error:", err);
    return null;
  }
}

/**
 * Publish a PCM audio buffer as a LiveKit audio track back to the room.
 * The ESP32 expects Opus; LiveKit's server SDK handles the encoding.
 */
async function publishAudio(room: Room, pcmBuffer: Buffer) {
  const { LocalAudioTrack, AudioSource } = await import("@livekit/rtc-node");

  const source = new AudioSource(24000, 1); // 24kHz mono (matches TTS PCM output)
  const track = LocalAudioTrack.createAudioTrack("agent-audio", source);

  await room.localParticipant?.publishTrack(track);

  // Stream PCM frames (10ms chunks = 240 samples at 24kHz)
  const FRAME_SAMPLES = 240;
  const FRAME_BYTES = FRAME_SAMPLES * 2; // 16-bit = 2 bytes per sample

  for (let offset = 0; offset + FRAME_BYTES <= pcmBuffer.length; offset += FRAME_BYTES) {
    const samples = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset + offset, FRAME_SAMPLES);
    const frame = new AudioFrame(samples, 24000, 1, FRAME_SAMPLES);
    await source.captureFrame(frame);
    // Pace the frames: 10ms per frame
    await new Promise<void>((r) => setTimeout(r, 10));
  }

  await room.localParticipant?.unpublishTrack(track);
}

/**
 * Build a minimal WAV header around raw PCM samples.
 */
function pcmToWav(pcm: Buffer, sampleRate: number, channels: number, bitDepth: number): Buffer {
  const byteRate = sampleRate * channels * (bitDepth / 8);
  const blockAlign = channels * (bitDepth / 8);
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);          // PCM chunk size
  header.writeUInt16LE(1, 20);           // PCM format
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitDepth, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm]);
}

main().catch((err) => {
  console.error("[livekit-agent] Fatal:", err);
  process.exit(1);
});
