"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useTheme, THEMES, ThemeId } from "@/components/theme-provider";

interface ProfileData {
  display_name: string;
  title: string;
  bio: string;
  location: string;
  phone: string;
  email: string;
  website: string;
  linkedin: string;
  github: string;
  twitter: string;
  skills: string;
  languages: string;
  company: string;
  screen_sharing_enabled: number;
  theme: string;
  timezone: string;
}

const EMPTY: ProfileData = {
  display_name: "",
  title: "",
  bio: "",
  location: "",
  phone: "",
  email: "",
  website: "",
  linkedin: "",
  github: "",
  twitter: "",
  skills: "[]",
  languages: "[]",
  company: "",
  screen_sharing_enabled: 1,
  theme: "ember",
  timezone: "",
};

export function ProfileConfig() {
  const [profile, setProfile] = useState<ProfileData>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [skillInput, setSkillInput] = useState("");
  const [langInput, setLangInput] = useState("");
  const { theme, setTheme, timezone, setTimezone } = useTheme();

  const timezones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      // Fallback for older engines
      return [
        "UTC",
        "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
        "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Moscow",
        "Asia/Dubai", "Asia/Kolkata", "Asia/Shanghai", "Asia/Tokyo",
        "Australia/Sydney", "Pacific/Auckland",
      ];
    }
  }, []);

  const load = useCallback(async () => {
    const res = await fetch("/api/config/profile");
    const data = await res.json();
    if (data && !data.error) {
      const merged = { ...EMPTY, ...data };
      setProfile(merged);
      // Sync with context — profile is the source of truth
      if (merged.theme && merged.theme !== theme) setTheme(merged.theme as ThemeId);
      if (merged.timezone !== timezone) setTimezone(merged.timezone || "");
    }
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const skills: string[] = (() => {
    try { return JSON.parse(profile.skills); } catch { return []; }
  })();

  const languages: string[] = (() => {
    try { return JSON.parse(profile.languages); } catch { return []; }
  })();

  const update = (field: keyof ProfileData, value: string | number) =>
    setProfile((p) => ({ ...p, [field]: typeof EMPTY[field] === "number" ? Number(value) : value }));

  const addSkill = () => {
    const v = skillInput.trim();
    if (v && !skills.includes(v)) {
      update("skills", JSON.stringify([...skills, v]));
      setSkillInput("");
    }
  };

  const removeSkill = (s: string) =>
    update("skills", JSON.stringify(skills.filter((x) => x !== s)));

  const addLang = () => {
    const v = langInput.trim();
    if (v && !languages.includes(v)) {
      update("languages", JSON.stringify([...languages, v]));
      setLangInput("");
    }
  };

  const removeLang = (l: string) =>
    update("languages", JSON.stringify(languages.filter((x) => x !== l)));

  const save = async () => {
    setSaving(true);
    await fetch("/api/config/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const labelClass = "text-[11px] font-medium text-muted-foreground/60 mb-1.5 block uppercase tracking-wider";

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Personal Information */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-display">Personal Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className={labelClass}>Display Name</label>
            <Input
              value={profile.display_name}
              onChange={(e) => update("display_name", e.target.value)}
              placeholder="Mohamed Nazmi"
            />
          </div>
          <div>
            <label className={labelClass}>Job Title</label>
            <Input
              value={profile.title}
              onChange={(e) => update("title", e.target.value)}
              placeholder="Senior Software Engineer"
            />
          </div>
          <div>
            <label className={labelClass}>Company</label>
            <Input
              value={profile.company}
              onChange={(e) => update("company", e.target.value)}
              placeholder="Acme Corp"
            />
          </div>
          <div>
            <label className={labelClass}>Location</label>
            <Input
              value={profile.location}
              onChange={(e) => update("location", e.target.value)}
              placeholder="City, Country"
            />
          </div>
          <div>
            <label className={labelClass}>Bio / Summary</label>
            <Textarea
              value={profile.bio}
              onChange={(e) => update("bio", e.target.value)}
              placeholder="A brief professional summary…"
              rows={4}
            />
          </div>
        </CardContent>
      </Card>

      {/* Contact & Social Links */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-display">Contact & Links</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <label className={labelClass}>Email</label>
            <Input
              type="email"
              value={profile.email}
              onChange={(e) => update("email", e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className={labelClass}>Phone</label>
            <Input
              value={profile.phone}
              onChange={(e) => update("phone", e.target.value)}
              placeholder="+1 555 123 4567"
            />
          </div>
          <div>
            <label className={labelClass}>Website</label>
            <Input
              value={profile.website}
              onChange={(e) => update("website", e.target.value)}
              placeholder="https://yoursite.com"
            />
          </div>
          <div>
            <label className={labelClass}>LinkedIn</label>
            <Input
              value={profile.linkedin}
              onChange={(e) => update("linkedin", e.target.value)}
              placeholder="https://linkedin.com/in/yourname"
            />
          </div>
          <div>
            <label className={labelClass}>GitHub</label>
            <Input
              value={profile.github}
              onChange={(e) => update("github", e.target.value)}
              placeholder="https://github.com/yourname"
            />
          </div>
          <div>
            <label className={labelClass}>Twitter / X</label>
            <Input
              value={profile.twitter}
              onChange={(e) => update("twitter", e.target.value)}
              placeholder="https://twitter.com/yourname"
            />
          </div>
        </CardContent>
      </Card>

      {/* Skills */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-display">Skills</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {skills.map((s) => (
              <Badge key={s} variant="secondary" className="gap-1 cursor-pointer" onClick={() => removeSkill(s)}>
                {s} <span className="text-xs opacity-60">✕</span>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={skillInput}
              onChange={(e) => setSkillInput(e.target.value)}
              placeholder="Add a skill…"
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSkill())}
            />
            <Button variant="outline" size="sm" onClick={addSkill}>
              Add
            </Button>
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
            {languages.map((l) => (
              <Badge key={l} variant="secondary" className="gap-1 cursor-pointer" onClick={() => removeLang(l)}>
                {l} <span className="text-xs opacity-60">✕</span>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={langInput}
              onChange={(e) => setLangInput(e.target.value)}
              placeholder="Add a language…"
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addLang())}
            />
            <Button variant="outline" size="sm" onClick={addLang}>
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Preferences — Theme & Timezone */}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-lg font-display">Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Theme picker */}
          <div>
            <label className={labelClass}>Theme</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 mt-1">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    update("theme", t.id);
                    setTheme(t.id);
                  }}
                  className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left border transition-all duration-200 ${
                    profile.theme === t.id
                      ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                      : "border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.03]"
                  }`}
                >
                  <span
                    className="h-4 w-4 rounded-full border border-white/20 shrink-0"
                    style={{ background: t.swatch }}
                  />
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium truncate">{t.label}</div>
                    <div className="text-[10px] text-muted-foreground/60 truncate">{t.description}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Timezone picker */}
          <div>
            <label className={labelClass}>Timezone</label>
            <select
              value={profile.timezone}
              onChange={(e) => {
                update("timezone", e.target.value);
                setTimezone(e.target.value);
              }}
              className="w-full rounded-lg border border-white/[0.08] bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="">Auto (browser default)</option>
              {timezones.map((tz) => (
                <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
              ))}
            </select>
            <p className="text-[10px] text-muted-foreground/50 mt-1">
              Controls how dates and times are displayed throughout the app.
              {timezone ? ` Current: ${timezone}` : " Using your browser's timezone."}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="md:col-span-2 flex justify-end gap-2 items-center">
        {saved && <span className="text-sm text-green-400">Saved!</span>}
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save Profile"}
        </Button>
      </div>

      {/* Features */}
      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle className="text-lg font-display">Features</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Screen Sharing</div>
              <div className="text-xs text-muted-foreground/60">Allow sharing your screen with Nexus during chat so it can see what you see.</div>
            </div>
            <Switch
              checked={profile.screen_sharing_enabled === 1}
              onCheckedChange={(checked) => update("screen_sharing_enabled", checked ? "1" : "0")}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
