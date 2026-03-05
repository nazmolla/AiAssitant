#!/usr/bin/env python3
"""OpenAI-compatible TTS server backed by Piper TTS.

Exposes POST /v1/audio/speech (same as OpenAI API).
Accepts: { model, voice, input, response_format }
Returns: audio bytes in the requested format.
"""
import io
import json
import subprocess
import wave
from http.server import HTTPServer, BaseHTTPRequestHandler

PIPER_BIN = "/home/nexusservice/.local/bin/piper"
MODELS_DIR = "/home/nexusservice/piper-models"
DEFAULT_MODEL = "en_US-lessac-medium"
HOST = "0.0.0.0"
PORT = 8084

# Map OpenAI voice names to Piper models (all map to same model for now)
VOICE_MAP = {
    "alloy": DEFAULT_MODEL,
    "ash": DEFAULT_MODEL,
    "coral": DEFAULT_MODEL,
    "echo": DEFAULT_MODEL,
    "fable": DEFAULT_MODEL,
    "onyx": DEFAULT_MODEL,
    "nova": DEFAULT_MODEL,
    "sage": DEFAULT_MODEL,
    "shimmer": DEFAULT_MODEL,
}


def synthesize(text, model_name=DEFAULT_MODEL, output_format="mp3"):
    model_path = f"{MODELS_DIR}/{model_name}.onnx"

    # Piper outputs raw PCM to stdout
    proc = subprocess.run(
        [PIPER_BIN, "--model", model_path, "--output-raw"],
        input=text.encode("utf-8"),
        capture_output=True,
        timeout=60,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"Piper failed: {proc.stderr.decode()}")

    raw_audio = proc.stdout

    # Read sample rate from model config
    config_path = f"{model_path}.json"
    sample_rate = 22050
    try:
        with open(config_path) as f:
            cfg = json.load(f)
            sample_rate = cfg.get("audio", {}).get("sample_rate", 22050)
    except Exception:
        pass

    if output_format == "pcm":
        return raw_audio, f"audio/L16;rate={sample_rate};channels=1"

    # Wrap raw PCM in WAV
    wav_buf = io.BytesIO()
    with wave.open(wav_buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)  # 16-bit
        wf.setframerate(sample_rate)
        wf.writeframes(raw_audio)
    wav_bytes = wav_buf.getvalue()

    if output_format == "wav":
        return wav_bytes, "audio/wav"

    # Convert to mp3/opus/etc using ffmpeg
    fmt_map = {
        "mp3": ("mp3", "audio/mpeg"),
        "opus": ("opus", "audio/opus"),
        "aac": ("adts", "audio/aac"),
        "flac": ("flac", "audio/flac"),
    }
    ff_fmt, mime = fmt_map.get(output_format, ("mp3", "audio/mpeg"))

    proc2 = subprocess.run(
        ["ffmpeg", "-i", "pipe:0", "-f", ff_fmt, "-y", "pipe:1"],
        input=wav_bytes,
        capture_output=True,
        timeout=30,
    )
    if proc2.returncode != 0:
        # Fallback to WAV if ffmpeg fails
        return wav_bytes, "audio/wav"

    return proc2.stdout, mime


class TTSHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/v1/audio/speech":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length)) if length > 0 else {}

        text = body.get("input", "")
        voice = body.get("voice", "nova")
        fmt = body.get("response_format", "mp3")

        if not text:
            self.send_error(400, "Missing input text")
            return

        try:
            model_name = VOICE_MAP.get(voice, DEFAULT_MODEL)
            audio_data, content_type = synthesize(text, model_name, fmt)

            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(audio_data)))
            self.end_headers()
            self.wfile.write(audio_data)
        except Exception as e:
            self.send_error(500, str(e))

    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok"}).encode())
        else:
            self.send_error(404)

    def log_message(self, format, *args):
        pass  # Suppress request logs


if __name__ == "__main__":
    print(f"Piper TTS server listening on {HOST}:{PORT}")
    print(f"Endpoint: POST /v1/audio/speech")
    server = HTTPServer((HOST, PORT), TTSHandler)
    server.serve_forever()
