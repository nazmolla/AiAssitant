"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function AlexaConfig() {
  const [ubidMain, setUbidMain] = useState("");
  const [atMain, setAtMain] = useState("");
  const [configured, setConfigured] = useState(false);
  const [maskedUbid, setMaskedUbid] = useState("");
  const [maskedAt, setMaskedAt] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/config/alexa");
      if (!res.ok) return;
      const data = await res.json();
      setConfigured(!!data.configured);
      setMaskedUbid(data.ubidMain || "");
      setMaskedAt(data.atMain || "");
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!ubidMain.trim() || !atMain.trim()) {
      setMessage("Both fields are required.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/config/alexa", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ubidMain: ubidMain.trim(), atMain: atMain.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessage(data?.error || "Failed to save Alexa credentials.");
      } else {
        setMessage("Alexa credentials saved successfully.");
        setUbidMain("");
        setAtMain("");
        setEditing(false);
        await load();
      }
    } catch {
      setMessage("Failed to save Alexa credentials.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Explainer */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display">Alexa Smart Home</CardTitle>
          <CardDescription className="text-muted-foreground/60">
            Connect Nexus to your Amazon Alexa account to control smart home devices,
            make announcements, check sensors, and more. You need your{" "}
            <code className="text-[11px] bg-white/5 px-1.5 py-0.5 rounded">UBID_MAIN</code> and{" "}
            <code className="text-[11px] bg-white/5 px-1.5 py-0.5 rounded">AT_MAIN</code> cookies
            from an authenticated Alexa session.
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Status / Form */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-display font-semibold">
            {configured ? "✅ Credentials Configured" : "⚠️ Not Configured"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {configured && !editing && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-muted-foreground/50 uppercase tracking-wider block mb-1">
                  UBID_MAIN
                </label>
                <div className="text-sm font-mono text-muted-foreground bg-white/5 rounded-lg px-3 py-2">
                  {maskedUbid}
                </div>
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground/50 uppercase tracking-wider block mb-1">
                  AT_MAIN
                </label>
                <div className="text-sm font-mono text-muted-foreground bg-white/5 rounded-lg px-3 py-2">
                  {maskedAt}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditing(true)}
              >
                Update Credentials
              </Button>
            </div>
          )}

          {(!configured || editing) && (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-muted-foreground/50 uppercase tracking-wider block mb-1">
                  UBID_MAIN
                </label>
                <input
                  type="text"
                  value={ubidMain}
                  onChange={(e) => setUbidMain(e.target.value)}
                  placeholder="Your UBID_MAIN cookie value"
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground/50 uppercase tracking-wider block mb-1">
                  AT_MAIN
                </label>
                <textarea
                  value={atMain}
                  onChange={(e) => setAtMain(e.target.value)}
                  placeholder="Atza|..."
                  rows={3}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={save} disabled={saving}>
                  {saving ? "Saving..." : "Save Credentials"}
                </Button>
                {editing && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => { setEditing(false); setUbidMain(""); setAtMain(""); setMessage(null); }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          )}

          {message && (
            <p className={`text-sm mt-2 ${message.includes("success") ? "text-green-400" : "text-red-400"}`}>
              {message}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Tools info */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-display font-semibold">Available Tools (14)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[12px] text-muted-foreground/70">
            <div>🔊 Announce on devices</div>
            <div>🌡️ Get bedroom state / sensors</div>
            <div>💡 List / control lights</div>
            <div>🎨 Set light color / brightness</div>
            <div>🎵 Get music status</div>
            <div>🔉 Get / set / adjust volume</div>
            <div>🏠 List smart home devices</div>
            <div>🔕 Get / set DND status</div>
          </div>
          <p className="text-[11px] text-muted-foreground/40 mt-3">
            Control tools (announce, light/volume/DND changes) require approval by default.
            Adjust in Tool Policies.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
