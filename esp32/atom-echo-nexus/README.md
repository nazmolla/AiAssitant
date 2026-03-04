# Atom Echo → Nexus Agent Voice Assistant

A bare-metal **ESP32 firmware** for the [M5Stack Atom Echo](https://docs.m5stack.com/en/atom/atomecho) that turns it into a hands-free voice assistant connected to your **Nexus Agent** instance.

## Features

| Feature | Details |
|---|---|
| **Wake word** | On-device wake word detection using **micro-wake-up** (no button press needed) |
| **Full Nexus pipeline** | STT → Conversation (with tools) → TTS → speaker playback |
| **LED feedback** | Blue (idle), Cyan (recording), Green (wake detected), Yellow (thinking), White (speaking), Red (error) |
| **Button override** | Press the built-in button to record without a wake word |
| **WAV audio** | Requests WAV from Nexus TTS — no MP3 decoder needed on device |
| **Low RAM** | Runs on the Atom Echo's ESP32-PICO-D4 (no PSRAM required) |

## How the Wake Word Works

Wake-word detection runs **on the ESP32 device** using **micro-wake-up**. The server is only used after wake detection for STT/LLM/TTS.

1. The microphone stream is continuously fed to the on-device micro-wake-up engine.
2. When the wake word is detected locally, the device records the follow-up command audio.
3. Command audio is sent to Nexus STT (`/api/audio/transcribe`).
4. The transcribed command is sent to Nexus conversation (`/api/conversation/respond`).
5. The response is synthesized with Nexus TTS (`/api/audio/tts`, WAV format) and played on-device.

This keeps wake detection local and avoids server-side wake-word matching.

## Hardware

| Component | Pin(s) |
|---|---|
| SPM1423 PDM Microphone | CLK: GPIO33, DATA: GPIO23 |
| NS4168 I2S Speaker | BCK: GPIO19, LRCK: GPIO33, DIN: GPIO22 |
| SK6812 RGB LED | GPIO27 |
| Button | GPIO39 |

> **Note:** The microphone and speaker share GPIO33 and cannot run simultaneously. The firmware automatically switches between mic capture and speaker playback modes.

## Prerequisites

- [PlatformIO](https://platformio.org/install) (CLI or VS Code extension)
- M5Stack Atom Echo connected via USB-C
- A running [Nexus Agent](../../README.md) instance with an API key

## Setup

### 1. Configure

Edit constants at the top of [`atom_echo_nexus.ino`](atom_echo_nexus.ino):

```c
#define WIFI_SSID       "YourWiFi"
#define WIFI_PASSWORD   "YourPassword"

#define NEXUS_HOST      "YOUR_SERVER_IP"   // Your Nexus server IP
#define NEXUS_PORT      3000
#define NEXUS_API_KEY   "nxk_your_key"   // From Nexus → Settings → API Keys
```

Then wire your installed **micro-wake-up** model/API inside:

- `wake_engine_init()`
- `wake_engine_process(...)`

### 2. Flash

```bash
cd esp32/atom-echo-nexus

# Build & upload
pio run -t upload

# Monitor serial output
pio device monitor
```

### 3. Use

1. Device boots and starts mic capture.
2. **micro-wake-up runs on-device continuously**.
3. After wake hit, the command is recorded locally.
4. Command is sent to Nexus (`/api/audio/transcribe` + `/api/conversation/respond`).
5. Response WAV is downloaded from `/api/audio/tts` and played through the speaker.

## Architecture

```
┌───────────────────┐
│ mic stream (ESP)  │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ micro-wake-up     │  (on-device wake detect)
└─────────┬─────────┘
          │ hit
          ▼
┌───────────────────┐
│ record command    │  (ESP local)
└─────────┬─────────┘
          ▼
 STT -> Conversation SSE -> TTS WAV -> playback
```

## API Endpoints Used

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/audio/transcribe` | POST multipart | Speech-to-text (WAV upload) |
| `/api/conversation/respond` | POST JSON → SSE | Chat with tools (streaming) |
| `/api/audio/tts` | POST JSON | Text-to-speech (WAV download) |

## Memory Budget

| Component | ~RAM Usage |
|---|---|
| WiFi + TLS stack | 70 KB |
| Audio recording buffer | 128 KB (4s × 16kHz × 16-bit) |
| HTTP buffers | 10–20 KB |
| TTS download buffer | Reuses recording buffer |
| Stack + misc | 20 KB |
| **Total** | **~240 KB of ~290 KB available** |

## Troubleshooting

| Problem | Solution |
|---|---|
| Won't connect to WiFi | Check SSID/password in `config.h`. Watch serial for errors. |
| "STT failed" | Verify Nexus is running and API key is valid. Check `NEXUS_HOST`/`NEXUS_PORT`. |
| False wake triggers | Increase `VAD_ENERGY_THRESHOLD` (try 1200–2000). |
| Misses wake word | Decrease `VAD_ENERGY_THRESHOLD` (try 400–600). Speak closer to the mic. |
| Audio sounds garbled | Check that TTS format is `"wav"` in `config.h`. |
| Heap allocation fails | Reduce `MAX_RECORD_SECONDS` to 3. |

## License

Same as the Nexus Agent project.
