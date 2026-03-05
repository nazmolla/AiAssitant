#!/usr/bin/env python3
"""OpenAI-compatible STT server backed by faster-whisper.

Exposes POST /v1/audio/transcriptions (same as OpenAI Whisper API).
Also exposes POST /inference (whisper.cpp compatibility).
Accepts multipart form with 'file' field + optional 'model', 'response_format'.
Returns: { text: "..." }
"""
import io
import json
import cgi
import tempfile
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from faster_whisper import WhisperModel

HOST = "0.0.0.0"
PORT = 8083
MODEL_SIZE = "small"  # small is good balance of speed/accuracy for CPU

print(f"Loading Whisper model '{MODEL_SIZE}' (CPU, int8)...")
model = WhisperModel(MODEL_SIZE, device="cpu", compute_type="int8")
print(f"Model loaded successfully.")


def transcribe(audio_bytes, filename="audio.webm"):
    """Transcribe audio bytes and return text."""
    # Write to temp file (faster-whisper needs a file path or file-like)
    suffix = os.path.splitext(filename)[1] or ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        segments, info = model.transcribe(tmp_path, beam_size=5)
        text = " ".join(seg.text.strip() for seg in segments)
        return text.strip()
    finally:
        os.unlink(tmp_path)


class STTHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path not in ("/v1/audio/transcriptions", "/inference"):
            self.send_error(404)
            return

        content_type = self.headers.get("Content-Type", "")

        if "multipart/form-data" not in content_type:
            self.send_error(400, "Expected multipart/form-data")
            return

        # Parse multipart form data
        try:
            environ = {
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": content_type,
                "CONTENT_LENGTH": self.headers.get("Content-Length", "0"),
            }
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ=environ,
            )

            # Get file field
            file_field = form["file"]
            if hasattr(file_field, "file"):
                audio_bytes = file_field.file.read()
                filename = file_field.filename or "audio.webm"
            else:
                self.send_error(400, "Missing 'file' field")
                return

        except Exception as e:
            self.send_error(400, f"Failed to parse form data: {e}")
            return

        try:
            text = transcribe(audio_bytes, filename)

            response_body = json.dumps({"text": text}).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(response_body)))
            self.end_headers()
            self.wfile.write(response_body)
        except Exception as e:
            error_body = json.dumps({"error": str(e)}).encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(error_body)))
            self.end_headers()
            self.wfile.write(error_body)

    def do_GET(self):
        if self.path == "/health":
            body = json.dumps({"status": "ok", "model": MODEL_SIZE}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_error(404)

    def log_message(self, format, *args):
        pass  # Suppress per-request logs


if __name__ == "__main__":
    print(f"Whisper STT server listening on {HOST}:{PORT}")
    print(f"Endpoints: POST /v1/audio/transcriptions, POST /inference, GET /health")
    server = HTTPServer((HOST, PORT), STTHandler)
    server.serve_forever()
