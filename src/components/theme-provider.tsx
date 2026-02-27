"use client";

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";

export type ThemeId = "ember" | "midnight" | "frost" | "sunrise" | "forest" | "amethyst" | "obsidian";

export interface ThemeOption {
  id: ThemeId;
  label: string;
  description: string;
  /** CSS preview swatch color (hsl string) */
  swatch: string;
  /** Whether it forces dark mode (no light variant) */
  darkOnly?: boolean;
}

export const THEMES: ThemeOption[] = [
  { id: "ember", label: "Ember", description: "Bold red, the original", swatch: "hsl(0 85% 60%)" },
  { id: "midnight", label: "Midnight", description: "Deep blue cinema", swatch: "hsl(230 80% 62%)", darkOnly: true },
  { id: "frost", label: "Frost", description: "Cool teal, minimal", swatch: "hsl(198 70% 50%)" },
  { id: "sunrise", label: "Sunrise", description: "Warm amber glow", swatch: "hsl(25 95% 55%)" },
  { id: "forest", label: "Forest", description: "Rich green nature", swatch: "hsl(152 70% 45%)", darkOnly: true },
  { id: "amethyst", label: "Amethyst", description: "Elegant violet", swatch: "hsl(270 70% 62%)", darkOnly: true },
  { id: "obsidian", label: "Obsidian", description: "Ultra-dark rose", swatch: "hsl(340 75% 58%)", darkOnly: true },
];

export type FontId = "inter" | "calibri" | "google" | "apple";

export interface FontOption {
  id: FontId;
  label: string;
  description: string;
  /** Preview font-family stack (used for swatch label rendering) */
  preview: string;
}

export const FONTS: FontOption[] = [
  { id: "inter", label: "Inter", description: "Clean & modern (default)", preview: "'Inter', system-ui, sans-serif" },
  { id: "calibri", label: "Calibri", description: "Microsoft classic", preview: "'Calibri', 'Carlito', 'Segoe UI', sans-serif" },
  { id: "google", label: "Roboto", description: "Google default", preview: "'Roboto', 'Arial', sans-serif" },
  { id: "apple", label: "SF Pro", description: "Apple system font", preview: "-apple-system, 'SF Pro Display', 'Helvetica Neue', sans-serif" },
];

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  font: FontId;
  setFont: (font: FontId) => void;
  timezone: string;
  setTimezone: (tz: string) => void;
  /** Format a UTC date string using the user's preferred timezone */
  formatDate: (utcDate: string, options?: Intl.DateTimeFormatOptions) => string;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "ember",
  setTheme: () => {},
  font: "inter",
  setFont: () => {},
  timezone: "",
  setTimezone: () => {},
  formatDate: (d) => new Date(d).toLocaleString(),
});

export function useTheme() {
  return useContext(ThemeContext);
}

const STORAGE_KEY = "nexus-theme";
const FONT_STORAGE_KEY = "nexus-font";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>("ember");
  const [font, setFontState] = useState<FontId>("inter");
  // Auto-detect browser timezone as default so times are always localized
  const [timezone, setTimezoneState] = useState<string>(() => {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { return ""; }
  });

  // Load from localStorage immediately, then override with DB profile
  useEffect(() => {
    // 1. Quick load from localStorage cache (prevents flash)
    try {
      const cached = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
      if (cached && THEMES.some((t) => t.id === cached)) {
        setThemeState(cached);
        applyTheme(cached);
      }
      const cachedFont = localStorage.getItem(FONT_STORAGE_KEY) as FontId | null;
      if (cachedFont && FONTS.some((f) => f.id === cachedFont)) {
        setFontState(cachedFont);
        applyFont(cachedFont);
      }
    } catch {}

    // 2. Load authoritative values from profile API
    fetch("/api/config/profile")
      .then((r) => r.json())
      .then((data) => {
        if (data && !data.error) {
          if (data.theme && THEMES.some((t: ThemeOption) => t.id === data.theme)) {
            setThemeState(data.theme);
            applyTheme(data.theme);
            try { localStorage.setItem(STORAGE_KEY, data.theme); } catch {}
          }
          if (data.font && FONTS.some((f: FontOption) => f.id === data.font)) {
            setFontState(data.font);
            applyFont(data.font);
            try { localStorage.setItem(FONT_STORAGE_KEY, data.font); } catch {}
          }
          if (typeof data.timezone === "string" && data.timezone) {
            setTimezoneState(data.timezone);
          }
        }
      })
      .catch(() => {
        // Not logged in or API unavailable — keep localStorage/defaults
      });
  }, []);

  /** Save a preference field to the profile API */
  const saveToProfile = useCallback((field: string, value: string) => {
    fetch("/api/config/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    }).catch(() => {});
  }, []);

  const setTheme = useCallback((id: ThemeId) => {
    setThemeState(id);
    applyTheme(id);
    try { localStorage.setItem(STORAGE_KEY, id); } catch {}
    saveToProfile("theme", id);
  }, [saveToProfile]);

  const setFont = useCallback((id: FontId) => {
    setFontState(id);
    applyFont(id);
    try { localStorage.setItem(FONT_STORAGE_KEY, id); } catch {}
    saveToProfile("font", id);
  }, [saveToProfile]);

  const setTimezone = useCallback((tz: string) => {
    setTimezoneState(tz);
    saveToProfile("timezone", tz);
  }, [saveToProfile]);

  const formatDate = useCallback((utcDate: string, options?: Intl.DateTimeFormatOptions) => {
    const normalized = utcDate.endsWith("Z") ? utcDate : utcDate + "Z";
    const date = new Date(normalized);
    const opts: Intl.DateTimeFormatOptions = {
      ...options,
      ...(timezone ? { timeZone: timezone } : {}),
    };
    return date.toLocaleString(undefined, opts);
  }, [timezone]);

  const contextValue = useMemo(
    () => ({ theme, setTheme, font, setFont, timezone, setTimezone, formatDate }),
    [theme, setTheme, font, setFont, timezone, setTimezone, formatDate]
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

function applyTheme(id: ThemeId) {
  const html = document.documentElement;
  html.removeAttribute("data-theme");
  if (id !== "ember") {
    html.setAttribute("data-theme", id);
  }
}

function applyFont(id: FontId) {
  const html = document.documentElement;
  html.removeAttribute("data-font");
  if (id !== "inter") {
    html.setAttribute("data-font", id);
  }
}
