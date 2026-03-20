"use client";

import { useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useTheme, THEMES, FONTS } from "@/components/theme-provider";
import { useProfileData } from "@/hooks/use-profile-data";
import { ChangePasswordSection } from "@/components/change-password-section";

const LABEL_CLASS = "text-[11px] font-medium text-muted-foreground/60 mb-1.5 block uppercase tracking-wider";

export function ProfileConfig() {
  const themeCtx = useTheme();
  const p = useProfileData(themeCtx);

  useEffect(() => { p.load(); }, [p.load]); // eslint-disable-line react-hooks/exhaustive-deps

  const timezoneOptions = useMemo(() => p.timezones.map((tz) => (
    <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
  )), [p.timezones]);

  const labelClass = LABEL_CLASS;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Personal Information */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-display">Personal Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-4">
            <div className="relative h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden border border-white/[0.08] shrink-0">
              {p.profile.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.profile.avatar_url} alt="Avatar" className="h-full w-full object-cover" />
              ) : (
                <span className="text-2xl font-bold text-primary/60">
                  {(p.profile.display_name || "?").charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <label className={labelClass}>Avatar URL</label>
              <Input value={p.profile.avatar_url} onChange={(e) => p.update("avatar_url", e.target.value)} placeholder="https://example.com/photo.jpg" />
              <p className="text-[10px] text-muted-foreground/50 mt-0.5">Paste a URL to your profile picture.</p>
            </div>
          </div>
          <div>
            <label className={labelClass}>Display Name</label>
            <Input value={p.profile.display_name} onChange={(e) => p.update("display_name", e.target.value)} placeholder="Demo User" />
          </div>
          <div>
            <label className={labelClass}>Job Title</label>
            <Input value={p.profile.title} onChange={(e) => p.update("title", e.target.value)} placeholder="Senior Software Engineer" />
          </div>
          <div>
            <label className={labelClass}>Company</label>
            <Input value={p.profile.company} onChange={(e) => p.update("company", e.target.value)} placeholder="Acme Corp" />
          </div>
          <div>
            <label className={labelClass}>Location</label>
            <Input value={p.profile.location} onChange={(e) => p.update("location", e.target.value)} placeholder="City, Country" />
          </div>
          <div>
            <label className={labelClass}>Bio / Summary</label>
            <Textarea value={p.profile.bio} onChange={(e) => p.update("bio", e.target.value)} placeholder="A brief professional summary…" rows={4} />
          </div>
        </CardContent>
      </Card>

      {/* Contact & Social Links */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-display">Contact &amp; Links</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className={labelClass}>Email</label>
            <Input type="email" value={p.profile.email} onChange={(e) => p.update("email", e.target.value)} placeholder="you@example.com" />
          </div>
          <div>
            <label className={labelClass}>Phone</label>
            <Input value={p.profile.phone} onChange={(e) => p.update("phone", e.target.value)} placeholder="+1 555 123 4567" />
          </div>
          <div>
            <label className={labelClass}>Website</label>
            <Input value={p.profile.website} onChange={(e) => p.update("website", e.target.value)} placeholder="https://yoursite.com" />
          </div>
          <div>
            <label className={labelClass}>LinkedIn</label>
            <Input value={p.profile.linkedin} onChange={(e) => p.update("linkedin", e.target.value)} placeholder="https://linkedin.com/in/yourname" />
          </div>
          <div>
            <label className={labelClass}>GitHub</label>
            <Input value={p.profile.github} onChange={(e) => p.update("github", e.target.value)} placeholder="https://github.com/yourname" />
          </div>
          <div>
            <label className={labelClass}>Twitter / X</label>
            <Input value={p.profile.twitter} onChange={(e) => p.update("twitter", e.target.value)} placeholder="https://twitter.com/yourname" />
          </div>
        </CardContent>
      </Card>

      {/* Additional Email Addresses */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-display">Additional Email Addresses</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground/70">
            Register additional email addresses to receive messages and inbound emails for any of them.
          </p>
          <div className="flex flex-col gap-2">
            {p.secondaryEmails.map((email) => (
              <div key={email} className="flex items-center justify-between gap-2 px-3 py-2 bg-secondary/30 rounded-lg border border-white/[0.06]">
                <span className="text-sm">{email}</span>
                <button onClick={() => p.removeSecondaryEmail(email)} className="text-xs text-destructive hover:text-destructive/80 underline">Remove</button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Input type="email" value={p.newEmailInput} onChange={(e) => p.setNewEmailInput(e.target.value)} placeholder="name@example.com" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), p.addSecondaryEmail())} />
            <Button variant="outline" size="sm" onClick={p.addSecondaryEmail} disabled={p.emailsLoading}>Add</Button>
          </div>
        </CardContent>
      </Card>

      {/* Languages */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-display">Languages</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {p.languages.map((l) => (
              <Badge key={l} variant="secondary" className="gap-1 cursor-pointer" onClick={() => p.removeLang(l)}>
                {l} <span className="text-xs opacity-60">✕</span>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input value={p.langInput} onChange={(e) => p.setLangInput(e.target.value)} placeholder="Add a language…" onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), p.addLang())} />
            <Button variant="outline" size="sm" onClick={p.addLang}>Add</Button>
          </div>
        </CardContent>
      </Card>

      {/* Preferences & Features */}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-lg font-display">Preferences &amp; Features</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Theme picker */}
          <div>
            <label className={labelClass}>Theme</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mt-1">
              {THEMES.map((t) => (
                <button key={t.id} onClick={() => { p.update("theme", t.id); themeCtx.setTheme(t.id); }} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left border transition-all duration-200 ${p.profile.theme === t.id ? "border-primary bg-primary/10 ring-1 ring-primary/30" : "border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.03]"}`}>
                  <span className="h-4 w-4 rounded-full border border-white/20 shrink-0" style={{ background: t.swatch }} />
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium truncate">{t.label}</div>
                    <div className="text-[10px] text-muted-foreground/60 truncate">{t.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Font picker */}
          <div>
            <label className={labelClass}>Font</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
              {FONTS.map((f) => (
                <button key={f.id} onClick={() => { p.update("font", f.id); themeCtx.setFont(f.id); }} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left border transition-all duration-200 ${p.profile.font === f.id ? "border-primary bg-primary/10 ring-1 ring-primary/30" : "border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.03]"}`}>
                  <span className="text-lg font-medium shrink-0 text-primary/70" style={{ fontFamily: f.preview }}>Aa</span>
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium truncate">{f.label}</div>
                    <div className="text-[10px] text-muted-foreground/60 truncate">{f.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Timezone picker */}
          <div>
            <label className={labelClass}>Timezone</label>
            <select value={p.profile.timezone} onChange={(e) => { p.update("timezone", e.target.value); themeCtx.setTimezone(e.target.value); }} className="w-full rounded-lg border border-white/[0.08] bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40">
              <option value="">Auto (browser default)</option>
              {timezoneOptions}
            </select>
            <p className="text-[10px] text-muted-foreground/50 mt-1">
              Controls how dates and times are displayed throughout the app.
              {themeCtx.timezone ? ` Current: ${themeCtx.timezone}` : " Using your browser's timezone."}
            </p>
          </div>

          <div>
            <label className={labelClass}>In-App Notification Level</label>
            <select value={p.profile.notification_level_inapp} onChange={(e) => p.update("notification_level_inapp", e.target.value)} className="w-full rounded-lg border border-white/[0.08] bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40">
              <option value="disaster">Disaster only</option>
              <option value="high">High + disaster</option>
              <option value="medium">Medium + high + disaster</option>
              <option value="low">All notifications</option>
            </select>
            <p className="text-[10px] text-muted-foreground/50 mt-1">
              Controls which severity levels appear in the notification bell and SSE stream.
            </p>
          </div>

          <div>
            <label className={labelClass}>External Notification Level</label>
            <select value={p.profile.notification_level} onChange={(e) => p.update("notification_level", e.target.value)} className="w-full rounded-lg border border-white/[0.08] bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40">
              <option value="disaster">Disaster only</option>
              <option value="high">High + disaster</option>
              <option value="medium">Medium + high + disaster</option>
              <option value="low">All notifications</option>
            </select>
            <p className="text-[10px] text-muted-foreground/50 mt-1">
              Controls which severity levels trigger external channel notifications (email, Discord, WhatsApp).
            </p>
          </div>

          {/* TTS Voice picker */}
          <div>
            <label className={labelClass}>TTS Voice</label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-1">
              {([
                { id: "alloy", label: "Alloy", desc: "Neutral & balanced" },
                { id: "ash", label: "Ash", desc: "Warm & clear" },
                { id: "coral", label: "Coral", desc: "Warm & engaging" },
                { id: "echo", label: "Echo", desc: "Smooth & resonant" },
                { id: "fable", label: "Fable", desc: "Expressive & dynamic" },
                { id: "onyx", label: "Onyx", desc: "Deep & authoritative" },
                { id: "nova", label: "Nova", desc: "Friendly & warm" },
                { id: "sage", label: "Sage", desc: "Calm & measured" },
                { id: "shimmer", label: "Shimmer", desc: "Bright & energetic" },
              ] as const).map((v) => (
                <button key={v.id} onClick={() => p.update("tts_voice", v.id)} className={`flex flex-col items-center gap-1 rounded-xl px-3 py-2.5 text-center border transition-all duration-200 ${p.profile.tts_voice === v.id ? "border-primary bg-primary/10 ring-1 ring-primary/30" : "border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.03]"}`}>
                  <div className="text-[13px] font-medium">{v.label}</div>
                  <div className="text-[10px] text-muted-foreground/60">{v.desc}</div>
                  <button type="button" onClick={(e) => { e.stopPropagation(); p.playVoicePreview(v.id); }} className="mt-0.5 text-[10px] text-primary/70 hover:text-primary underline" disabled={p.previewingVoice === v.id}>
                    {p.previewingVoice === v.id ? "Playing…" : "Preview"}
                  </button>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground/50 mt-1">
              The voice used when reading messages aloud. Changes take effect on the next TTS request.
            </p>
          </div>

          {/* Screen Sharing toggle */}
          <div className="flex items-center justify-between pt-2 border-t border-white/[0.06]">
            <div>
              <div className="text-sm font-medium">Screen Sharing</div>
              <div className="text-xs text-muted-foreground/60">Allow sharing your screen with Nexus during chat so it can see what you see.</div>
            </div>
            <Switch checked={p.profile.screen_sharing_enabled === 1} onCheckedChange={(checked) => p.update("screen_sharing_enabled", checked ? "1" : "0")} />
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="md:col-span-2 flex justify-end gap-2 items-center">
        {p.saved && <span className="text-sm text-green-400">Saved!</span>}
        <Button onClick={p.save} disabled={p.saving}>
          {p.saving ? "Saving…" : "Save Profile"}
        </Button>
      </div>

      <ChangePasswordSection />
    </div>
  );
}
