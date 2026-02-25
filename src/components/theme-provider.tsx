"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";

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

interface ThemeContextValue {
  theme: ThemeId;
  setTheme: (theme: ThemeId) => void;
  timezone: string;
  setTimezone: (tz: string) => void;
  /** Format a UTC date string using the user's preferred timezone */
  formatDate: (utcDate: string, options?: Intl.DateTimeFormatOptions) => string;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "ember",
  setTheme: () => {},
  timezone: "",
  setTimezone: () => {},
  formatDate: (d) => new Date(d).toLocaleString(),
});

export function useTheme() {
  return useContext(ThemeContext);
}

const STORAGE_KEY = "nexus-theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>("ember");
  const [timezone, setTimezoneState] = useState<string>("");

  // Load from localStorage immediately, then override with DB profile
  useEffect(() => {
    // 1. Quick load from localStorage cache (prevents flash)
    try {
      const cached = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
      if (cached && THEMES.some((t) => t.id === cached)) {
        setThemeState(cached);
        applyTheme(cached);
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
          if (typeof data.timezone === "string") {
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

  return (
    <ThemeContext.Provider value={{ theme, setTheme, timezone, setTimezone, formatDate }}>
      {children}
    </ThemeContext.Provider>
  );
}

function applyTheme(id: ThemeId) {
  const html = document.documentElement;
  // Remove all theme data attributes
  html.removeAttribute("data-theme");
  if (id !== "ember") {
    html.setAttribute("data-theme", id);
  }
}
