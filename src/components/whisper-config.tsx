"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface WhisperConfig {
  enabled: boolean;
  url: string;
  model: string;
}

export function WhisperConfig() {
  const [config, setConfig] = useState<WhisperConfig>({ enabled: false, url: "", model: "whisper-1" });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageType, setMessageType] = useState<"success" | "error">("success");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/config/whisper");
      if (!res.ok) return;
      const data = await res.json();
      setConfig({
        enabled: data.enabled ?? false,
        url: data.url ?? "",
        model: data.model ?? "whisper-1",
      });
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/config/whisper", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data?.error || "Failed to save Whisper config.");
        setMessageType("error");
      } else {
        setMessage("Local Whisper configuration saved.");
        setMessageType("success");
      }
    } catch {
      setMessage("Failed to save Whisper config.");
      setMessageType("error");
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/config/whisper", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setMessage(`Connection successful: ${data.detail || "server is reachable"}`);
        setMessageType("success");
      } else {
        setMessage(data.error || "Connection test failed.");
        setMessageType("error");
      }
    } catch {
      setMessage("Connection test failed — network error.");
      setMessageType("error");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <Card>
        <CardHeader>
          <CardTitle>Local Whisper Server</CardTitle>
          <CardDescription>
            Deploy a local Whisper server as a fallback for cloud Speech-to-Text.
            When enabled, if the cloud STT provider fails, Nexus will
            automatically retry using the local Whisper server.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Enable toggle */}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(e) => setConfig((c) => ({ ...c, enabled: e.target.checked }))}
                  style={{ width: 18, height: 18, accentColor: "#1976d2" }}
                />
                <span style={{ fontWeight: 500 }}>Enable local Whisper fallback</span>
              </label>
            </div>

            {/* URL field */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label htmlFor="whisper-url" style={{ fontSize: 14, fontWeight: 500 }}>
                Server URL
              </label>
              <input
                id="whisper-url"
                type="url"
                placeholder="http://localhost:8083"
                value={config.url}
                onChange={(e) => setConfig((c) => ({ ...c, url: e.target.value }))}
                style={{
                  padding: "8px 12px",
                  border: "1px solid #ccc",
                  borderRadius: 6,
                  fontSize: 14,
                  width: "100%",
                  maxWidth: 500,
                }}
              />
              <span style={{ fontSize: 12, color: "#888" }}>
                OpenAI-compatible endpoint (e.g. faster-whisper-server, whisper.cpp).
                Must expose <code>/v1/audio/transcriptions</code>.
              </span>
            </div>

            {/* Model field */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label htmlFor="whisper-model" style={{ fontSize: 14, fontWeight: 500 }}>
                Model name
              </label>
              <input
                id="whisper-model"
                type="text"
                placeholder="whisper-1"
                value={config.model}
                onChange={(e) => setConfig((c) => ({ ...c, model: e.target.value }))}
                style={{
                  padding: "8px 12px",
                  border: "1px solid #ccc",
                  borderRadius: 6,
                  fontSize: 14,
                  width: "100%",
                  maxWidth: 300,
                }}
              />
              <span style={{ fontSize: 12, color: "#888" }}>
                Model to request from the local server (e.g. &quot;large-v3&quot;, &quot;small&quot;, &quot;whisper-1&quot;).
              </span>
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save Configuration"}
              </Button>
              <Button
                onClick={testConnection}
                disabled={testing || !config.url}
                variant="outline"
              >
                {testing ? "Testing…" : "Test Connection"}
              </Button>
            </div>

            {/* Status message */}
            {message && (
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: 6,
                  fontSize: 14,
                  backgroundColor: messageType === "success" ? "#e6f4ea" : "#fce8e6",
                  color: messageType === "success" ? "#1e7e34" : "#c5221f",
                  border: `1px solid ${messageType === "success" ? "#a8dab5" : "#f5c6cb"}`,
                }}
              >
                {message}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Deployment guide */}
      <Card>
        <CardHeader>
          <CardTitle>Deployment Guide</CardTitle>
          <CardDescription>
            How to set up a local Whisper server on your Jetson or Linux machine.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div style={{ fontSize: 14, lineHeight: 1.7 }}>
            <p style={{ marginBottom: 12 }}>
              <strong>Option 1: faster-whisper-server (recommended for Jetson)</strong>
            </p>
            <pre style={{
              background: "#1e1e1e",
              color: "#d4d4d4",
              padding: 12,
              borderRadius: 6,
              overflow: "auto",
              fontSize: 13,
              marginBottom: 16,
            }}>
{`# Install faster-whisper-server (Python, uses CTranslate2 + CUDA)
pip install faster-whisper-server

# Run on port 8083 with large-v3 model
faster-whisper-server --model large-v3 --host 0.0.0.0 --port 8083

# Or use Docker:
docker run -d --gpus all -p 8083:8000 \\
  fedirz/faster-whisper-server:latest-cuda`}
            </pre>

            <p style={{ marginBottom: 12 }}>
              <strong>Option 2: whisper.cpp HTTP server</strong>
            </p>
            <pre style={{
              background: "#1e1e1e",
              color: "#d4d4d4",
              padding: 12,
              borderRadius: 6,
              overflow: "auto",
              fontSize: 13,
              marginBottom: 16,
            }}>
{`# Build whisper.cpp with CUDA support
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp && make WHISPER_CUDA=1 server

# Download a model
bash models/download-ggml-model.sh large-v3

# Start the server
./server -m models/ggml-large-v3.bin --host 0.0.0.0 --port 8083`}
            </pre>

            <p style={{ marginBottom: 12 }}>
              <strong>Option 3: systemd service (auto-start on boot)</strong>
            </p>
            <pre style={{
              background: "#1e1e1e",
              color: "#d4d4d4",
              padding: 12,
              borderRadius: 6,
              overflow: "auto",
              fontSize: 13,
            }}>
{`# Create /etc/systemd/system/whisper-local.service
[Unit]
Description=Local Whisper STT Server
After=network.target

[Service]
Type=simple
User=<user>
ExecStart=/usr/local/bin/faster-whisper-server \\
  --model large-v3 --host 0.0.0.0 --port 8083
Restart=always

[Install]
WantedBy=multi-user.target

# Enable and start:
sudo systemctl enable whisper-local
sudo systemctl start whisper-local`}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
