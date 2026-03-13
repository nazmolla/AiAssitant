import React, { useState, useCallback, useMemo } from "react";
import type { ThemeId, FontId } from "@/components/theme-provider";

export interface ProfileData {
  display_name: string;
  avatar_url: string;
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
  notification_level: string;
  theme: string;
  font: string;
  timezone: string;
  tts_voice: string;
}

export const EMPTY_PROFILE: ProfileData = {
  display_name: "",
  avatar_url: "",
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
  notification_level: "disaster",
  theme: "ember",
  font: "inter",
  timezone: "",
  tts_voice: "nova",
};

interface ThemeCtx {
  theme: string;
  setTheme: (t: ThemeId) => void;
  font: string;
  setFont: (f: FontId) => void;
  timezone: string;
  setTimezone: (tz: string) => void;
}

export function useProfileData(themeCtx: ThemeCtx) {
  const [profile, setProfile] = useState<ProfileData>(EMPTY_PROFILE);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [langInput, setLangInput] = useState("");
  const [newEmailInput, setNewEmailInput] = useState("");
  const [secondaryEmails, setSecondaryEmails] = useState<string[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const previewAudioRef = React.useRef<HTMLAudioElement | null>(null);

  const timezones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [
        "UTC",
        "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
        "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Moscow",
        "Asia/Dubai", "Asia/Kolkata", "Asia/Shanghai", "Asia/Tokyo",
        "Australia/Sydney", "Pacific/Auckland",
      ];
    }
  }, []);

  const languages: string[] = useMemo(() => {
    try { return JSON.parse(profile.languages) as string[]; } catch { return []; }
  }, [profile.languages]);

  const update = useCallback((field: keyof ProfileData, value: string | number) => {
    setProfile((p) => ({ ...p, [field]: typeof EMPTY_PROFILE[field] === "number" ? Number(value) : value }));
  }, []);

  const load = useCallback(async () => {
    const res = await fetch("/api/config/profile");
    const data = await res.json();
    if (data && !data.error) {
      const merged = { ...EMPTY_PROFILE, ...data };
      setProfile(merged);
      if (merged.theme && merged.theme !== themeCtx.theme) themeCtx.setTheme(merged.theme as ThemeId);
      if (merged.font && merged.font !== themeCtx.font) themeCtx.setFont(merged.font as FontId);
      if (merged.timezone !== themeCtx.timezone) themeCtx.setTimezone(merged.timezone || "");
      if (merged.tts_voice) {
        try { localStorage.setItem("nexus_tts_voice", merged.tts_voice); } catch { /* noop */ }
      }
    }
    try {
      setEmailsLoading(true);
      const emailRes = await fetch("/api/config/user-emails");
      const emailData = await emailRes.json();
      if (emailData?.secondary) setSecondaryEmails(emailData.secondary);
    } catch { /* ignore */ } finally { setEmailsLoading(false); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback(async () => {
    setSaving(true);
    await fetch("/api/config/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profile),
    });
    try { localStorage.setItem("nexus_tts_voice", profile.tts_voice || "nova"); } catch { /* noop */ }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [profile]);

  const addLang = useCallback(() => {
    const v = langInput.trim();
    if (v && !languages.includes(v)) {
      update("languages", JSON.stringify([...languages, v]));
      setLangInput("");
    }
  }, [langInput, languages, update]);

  const removeLang = useCallback((l: string) => {
    update("languages", JSON.stringify(languages.filter((x) => x !== l)));
  }, [languages, update]);

  const addSecondaryEmail = useCallback(async () => {
    const v = newEmailInput.trim().toLowerCase();
    if (!v || secondaryEmails.includes(v)) return;
    try {
      const res = await fetch("/api/config/user-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: v }),
      });
      const data = await res.json();
      if (res.ok) {
        setSecondaryEmails([...secondaryEmails, v]);
        setNewEmailInput("");
      } else { console.error("Failed to add email:", data.error); }
    } catch (err) { console.error("Error adding email:", err); }
  }, [newEmailInput, secondaryEmails]);

  const removeSecondaryEmail = useCallback(async (e: string) => {
    try {
      const res = await fetch("/api/config/user-emails", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: e }),
      });
      if (res.ok) {
        setSecondaryEmails(secondaryEmails.filter((x) => x !== e));
      } else {
        const data = await res.json();
        console.error("Failed to remove email:", data.error);
      }
    } catch (err) { console.error("Error removing email:", err); }
  }, [secondaryEmails]);

  const playVoicePreview = useCallback(async (voiceId: string) => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    setPreviewingVoice(voiceId);
    try {
      const res = await fetch("/api/audio/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Hello! This is how I sound.", voice: voiceId }),
      });
      if (!res.ok) { setPreviewingVoice(null); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = () => { URL.revokeObjectURL(url); setPreviewingVoice(null); previewAudioRef.current = null; };
      audio.onerror = () => { URL.revokeObjectURL(url); setPreviewingVoice(null); previewAudioRef.current = null; };
      await audio.play();
    } catch { setPreviewingVoice(null); }
  }, []);

  return {
    profile, update, load, save, saving, saved,
    languages, langInput, setLangInput, addLang, removeLang,
    secondaryEmails, newEmailInput, setNewEmailInput, addSecondaryEmail, removeSecondaryEmail, emailsLoading,
    previewingVoice, playVoicePreview,
    timezones,
  };
}
