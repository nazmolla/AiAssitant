"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useConfirm } from "@/hooks/use-confirm";

type ChannelType = "whatsapp" | "slack" | "email" | "telegram" | "discord" | "teams" | "phone";

interface Channel {
  id: string;
  channel_type: ChannelType;
  label: string;
  enabled: number;
  config_json: string;
  webhook_secret: string | null;
  created_at: string;
}

const CHANNEL_OPTIONS: { value: ChannelType; label: string; icon: string; description: string }[] = [
  { value: "whatsapp", label: "WhatsApp", icon: "💬", description: "WhatsApp Business Cloud API" },
  { value: "slack", label: "Slack", icon: "💼", description: "Slack Events API" },
  { value: "email", label: "Email", icon: "📧", description: "Shared SMTP/IMAP inbox" },
  { value: "telegram", label: "Telegram", icon: "✈️", description: "Telegram Bot API" },
  { value: "discord", label: "Discord", icon: "🎮", description: "Discord Bot interaction" },
  { value: "teams", label: "Teams", icon: "👥", description: "Microsoft Teams Bot Framework" },
  { value: "phone", label: "Phone Call", icon: "📞", description: "Voice phone calls via webhook" },
];

const CONFIG_FIELDS: Record<ChannelType, { key: string; label: string; type: "text" | "password" }[]> = {
  whatsapp: [
    { key: "phoneNumberId", label: "Phone Number ID", type: "text" },
    { key: "accessToken", label: "Access Token", type: "password" },
    { key: "verifyToken", label: "Verify Token", type: "text" },
  ],
  slack: [
    { key: "botToken", label: "Bot Token (xoxb-...)", type: "password" },
    { key: "signingSecret", label: "Signing Secret", type: "password" },
    { key: "appId", label: "App ID", type: "text" },
  ],
  email: [
    { key: "smtpHost", label: "SMTP Host", type: "text" },
    { key: "smtpPort", label: "SMTP Port", type: "text" },
    { key: "smtpUser", label: "SMTP Username", type: "text" },
    { key: "smtpPass", label: "SMTP Password", type: "password" },
    { key: "fromAddress", label: "From Address", type: "text" },
    { key: "imapHost", label: "IMAP Host", type: "text" },
    { key: "imapPort", label: "IMAP Port", type: "text" },
    { key: "imapUser", label: "IMAP Username", type: "text" },
    { key: "imapPass", label: "IMAP Password", type: "password" },
  ],
  telegram: [
    { key: "botToken", label: "Bot Token", type: "password" },
    { key: "botUsername", label: "Bot Username", type: "text" },
  ],
  discord: [
    { key: "botToken", label: "Bot Token", type: "password" },
  ],
  teams: [
    { key: "appId", label: "App ID", type: "text" },
    { key: "appPassword", label: "App Password", type: "password" },
    { key: "tenantId", label: "Tenant ID", type: "text" },
  ],
  phone: [
    { key: "provider", label: "Provider (twilio)", type: "text" },
    { key: "accountSid", label: "Twilio Account SID", type: "text" },
    { key: "authToken", label: "Twilio Auth Token", type: "password" },
    { key: "phoneNumber", label: "Twilio Phone Number (from)", type: "text" },
    { key: "voiceName", label: "Voice Name (optional)", type: "text" },
  ],
};

export function ChannelsConfig() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedType, setSelectedType] = useState<ChannelType | null>(null);
  const [label, setLabel] = useState("");
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { confirmDialog, openConfirm } = useConfirm();

  const fetchChannels = () => {
    fetch("/api/config/channels")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setChannels(d); })
      .catch(console.error);
  };

  useEffect(() => { fetchChannels(); }, []);

  function resetForm() {
    setShowForm(false);
    setSelectedType(null);
    setLabel("");
    setConfigValues({});
    setError(null);
  }

  async function handleCreate() {
    if (!selectedType || !label.trim()) return;

    // Validate required config fields
    const requiredFields = CONFIG_FIELDS[selectedType] || [];
    for (const field of requiredFields) {
      if (!configValues[field.key]?.trim()) {
        setError(`${field.label} is required.`);
        return;
      }
    }

    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/config/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          channelType: selectedType,
          config: configValues,
        }),
      });
      if (res.ok) {
        resetForm();
        fetchChannels();
      } else {
        const data = await res.json().catch(() => null);
        setError(data?.error || `Failed to connect (${res.status})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(channel: Channel) {
    await fetch("/api/config/channels", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: channel.id, enabled: !channel.enabled }),
    });
    fetchChannels();
  }

  async function handleDelete(id: string) {
    if (!(await openConfirm("Delete this channel?"))) return;
    await fetch(`/api/config/channels?id=${id}`, { method: "DELETE" });
    fetchChannels();
  }

  function copyWebhookUrl(channel: Channel) {
    const base = typeof window !== "undefined" ? window.location.origin : "";
    const url = `${base}/api/channels/${channel.id}/webhook?secret=${channel.webhook_secret || ""}`;
    navigator.clipboard.writeText(url);
    setCopiedId(channel.id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  const fields = selectedType ? CONFIG_FIELDS[selectedType] : [];

  return (
    <div className="space-y-4">
      {/* Existing channels */}
      {channels.length === 0 && !showForm && (
        <Card className="border-dashed border-white/[0.08]">
          <CardContent className="py-12 text-center">
            <div className="text-3xl mb-3 opacity-30">📡</div>
            <p className="text-sm font-medium text-foreground/60 mb-1">No channels connected</p>
            <p className="text-xs text-muted-foreground/50 font-light">Connect a messaging platform to chat with Nexus from anywhere.</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3">
        {channels.map((ch) => {
          const opt = CHANNEL_OPTIONS.find((o) => o.value === ch.channel_type);
          return (
            <Card key={ch.id}>
              <CardContent className="py-4">
                <div className="md:hidden space-y-3">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl shrink-0">{opt?.icon || "📡"}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium break-words">{ch.label}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="text-xs">
                          {opt?.label || ch.channel_type}
                        </Badge>
                        <Badge variant={ch.enabled ? "success" : "secondary"} className="text-xs">
                          {ch.enabled ? "Active" : "Disabled"}
                        </Badge>
                        {ch.channel_type === "discord" && (ch as any).discord_bot_active && (
                          <Badge variant="success" className="text-xs">
                            🤖 Bot Online
                          </Badge>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1.5 font-mono break-all">
                        {ch.channel_type === "discord"
                          ? "Gateway Bot — responds to mentions, DMs, and /ask"
                          : `Webhook: /api/channels/${ch.id}/webhook`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {ch.channel_type !== "discord" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1"
                        onClick={() => copyWebhookUrl(ch)}
                        title="Copy webhook URL"
                      >
                        {copiedId === ch.id ? "✓ Copied" : "📋 Copy URL"}
                      </Button>
                    )}
                    <div className="flex items-center justify-center rounded-lg border border-white/[0.08] px-2.5 py-1.5">
                      <Switch
                        checked={!!ch.enabled}
                        onCheckedChange={() => toggleEnabled(ch)}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(ch.id)}
                    >
                      ✕
                    </Button>
                  </div>
                </div>

                <div className="hidden md:flex items-center gap-4">
                  <span className="text-2xl">{opt?.icon || "📡"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{ch.label}</span>
                      <Badge variant="outline" className="text-xs">
                        {opt?.label || ch.channel_type}
                      </Badge>
                      <Badge variant={ch.enabled ? "success" : "secondary"} className="text-xs">
                        {ch.enabled ? "Active" : "Disabled"}
                      </Badge>
                      {ch.channel_type === "discord" && (ch as any).discord_bot_active && (
                        <Badge variant="success" className="text-xs">
                          🤖 Bot Online
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 font-mono truncate">
                      {ch.channel_type === "discord"
                        ? "Gateway Bot — responds to mentions, DMs, and /ask"
                        : `Webhook: /api/channels/${ch.id}/webhook`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {ch.channel_type !== "discord" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyWebhookUrl(ch)}
                        title="Copy webhook URL"
                      >
                        {copiedId === ch.id ? "✓ Copied" : "📋 Copy URL"}
                      </Button>
                    )}
                    <Switch
                      checked={!!ch.enabled}
                      onCheckedChange={() => toggleEnabled(ch)}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => handleDelete(ch.id)}
                    >
                      ✕
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Add channel form */}
      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-display">Connect a Channel</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Step 1: Choose type */}
            {!selectedType ? (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {CHANNEL_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setSelectedType(opt.value)}
                    className="flex flex-col items-center gap-2 p-5 rounded-xl border border-white/[0.06] hover:bg-white/[0.04] hover:border-primary/20 transition-all duration-300 text-center"
                  >
                    <span className="font-medium text-sm">{opt.icon} {opt.label}</span>
                    <span className="text-xs text-muted-foreground/60 font-light">{opt.description}</span>
                  </button>
                ))}
              </div>
            ) : (
              <>
                {/* Step 2: Configure */}
                <div className="flex items-center gap-2 mb-2">
                  <Button variant="ghost" size="sm" onClick={() => setSelectedType(null)}>
                    ← Back
                  </Button>
                  <span className="text-lg">
                    {CHANNEL_OPTIONS.find((o) => o.value === selectedType)?.icon}{" "}
                    {CHANNEL_OPTIONS.find((o) => o.value === selectedType)?.label}
                  </span>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium mb-1 block">Display Name</label>
                    <Input
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="e.g., My WhatsApp Bot"
                    />
                  </div>

                  {fields.map((field) => (
                    <div key={field.key}>
                      <label className="text-sm font-medium mb-1 block">{field.label}</label>
                      <Input
                        type={field.type}
                        value={configValues[field.key] || ""}
                        onChange={(e) =>
                          setConfigValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                        }
                        placeholder={field.label}
                      />
                    </div>
                  ))}
                </div>

                {error && (
                  <div className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                    {error}
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <Button onClick={handleCreate} disabled={saving || !label.trim()}>
                    {saving ? "Saving..." : "Connect Channel"}
                  </Button>
                  <Button variant="outline" onClick={resetForm}>
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : (
        <Button onClick={() => setShowForm(true)} variant="outline" className="w-full">
          + Connect Channel
        </Button>
      )}

      {/* How it works info */}
      {channels.length > 0 && (
        <Card className="bg-white/[0.02] border-white/[0.06]">
          <CardContent className="py-4 text-sm text-muted-foreground/60 space-y-2">
            <p className="font-medium text-foreground/80">How channels work</p>
            <ol className="list-decimal ml-4 space-y-1">
              <li><strong>Discord:</strong> The bot connects automatically via Gateway. Add it to your server, and it responds to @mentions, DMs, and <code>/ask</code> slash commands.</li>
              <li><strong>Other platforms:</strong> Copy the webhook URL using the 📋 button, set it as the callback in your platform&apos;s settings, and Nexus will process incoming messages.</li>
              <li>Map external users to Nexus accounts in the channel settings for personalized responses.</li>
            </ol>
          </CardContent>
        </Card>
      )}
      {confirmDialog}
    </div>
  );
}
