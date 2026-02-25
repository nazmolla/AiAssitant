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
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "ember",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

const STORAGE_KEY = "nexus-theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>("ember");

  // Load saved theme on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
      if (saved && THEMES.some((t) => t.id === saved)) {
        setThemeState(saved);
        applyTheme(saved);
      }
    } catch {
      // ignore — SSR or localStorage unavailable
    }
  }, []);

  const setTheme = useCallback((id: ThemeId) => {
    setThemeState(id);
    applyTheme(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // ignore
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
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
