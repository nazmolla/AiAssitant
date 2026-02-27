"use client";

import { createTheme, type ThemeOptions } from "@mui/material/styles";
import type { ThemeId } from "@/components/theme-provider";

/* ────────────────────────────────────────────────────────────
   HSL → hex helper  (all theme swatches are in HSL)
   ──────────────────────────────────────────────────────────── */

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/* ────────────────────────────────────────────────────────────
   Per-theme color tokens  (dark-mode variants only for dark-only themes)
   ──────────────────────────────────────────────────────────── */

interface ThemeTokens {
  primary: string;
  background: string;
  paper: string;
  textPrimary: string;
  textSecondary: string;
  divider: string;
  error: string;
  mode: "light" | "dark";
}

const THEME_TOKENS: Record<ThemeId, ThemeTokens> = {
  ember: {
    primary: hslToHex(0, 85, 60),
    background: hslToHex(0, 0, 4),
    paper: hslToHex(0, 0, 7),
    textPrimary: hslToHex(0, 0, 95),
    textSecondary: hslToHex(0, 0, 50),
    divider: hslToHex(0, 0, 14),
    error: hslToHex(0, 72, 51),
    mode: "dark",
  },
  midnight: {
    primary: hslToHex(230, 80, 62),
    background: hslToHex(230, 25, 5),
    paper: hslToHex(230, 25, 8),
    textPrimary: hslToHex(220, 20, 95),
    textSecondary: hslToHex(220, 10, 55),
    divider: hslToHex(230, 15, 16),
    error: hslToHex(0, 72, 51),
    mode: "dark",
  },
  frost: {
    primary: hslToHex(198, 70, 50),
    background: hslToHex(210, 25, 5),
    paper: hslToHex(210, 25, 8),
    textPrimary: hslToHex(210, 20, 95),
    textSecondary: hslToHex(210, 10, 55),
    divider: hslToHex(210, 15, 16),
    error: hslToHex(0, 72, 51),
    mode: "dark",
  },
  sunrise: {
    primary: hslToHex(25, 95, 55),
    background: hslToHex(25, 20, 5),
    paper: hslToHex(25, 20, 8),
    textPrimary: hslToHex(30, 20, 95),
    textSecondary: hslToHex(30, 10, 50),
    divider: hslToHex(25, 10, 16),
    error: hslToHex(0, 72, 51),
    mode: "dark",
  },
  forest: {
    primary: hslToHex(152, 70, 45),
    background: hslToHex(150, 15, 5),
    paper: hslToHex(150, 15, 8),
    textPrimary: hslToHex(150, 10, 95),
    textSecondary: hslToHex(150, 8, 50),
    divider: hslToHex(150, 10, 16),
    error: hslToHex(0, 72, 51),
    mode: "dark",
  },
  amethyst: {
    primary: hslToHex(270, 70, 62),
    background: hslToHex(270, 20, 5),
    paper: hslToHex(270, 20, 8),
    textPrimary: hslToHex(270, 10, 95),
    textSecondary: hslToHex(270, 8, 50),
    divider: hslToHex(270, 10, 16),
    error: hslToHex(0, 72, 51),
    mode: "dark",
  },
  obsidian: {
    primary: hslToHex(340, 75, 58),
    background: hslToHex(0, 0, 2),
    paper: hslToHex(0, 0, 5),
    textPrimary: hslToHex(0, 0, 92),
    textSecondary: hslToHex(0, 0, 45),
    divider: hslToHex(0, 0, 12),
    error: hslToHex(0, 72, 51),
    mode: "dark",
  },
};

/* ────────────────────────────────────────────────────────────
   Build a MUI theme for a given Nexus theme ID
   ──────────────────────────────────────────────────────────── */

export function buildMuiTheme(themeId: ThemeId) {
  const t = THEME_TOKENS[themeId] ?? THEME_TOKENS.ember;

  const options: ThemeOptions = {
    palette: {
      mode: t.mode,
      primary: { main: t.primary },
      error: { main: t.error },
      background: { default: t.background, paper: t.paper },
      text: { primary: t.textPrimary, secondary: t.textSecondary },
      divider: t.divider,
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: "inherit",
      h4: { fontWeight: 700 },
      h5: { fontWeight: 700 },
      h6: { fontWeight: 600 },
      subtitle1: { fontWeight: 500 },
      button: { textTransform: "none", fontWeight: 500 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            backgroundColor: t.background,
            color: t.textPrimary,
          },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            borderRadius: 10,
            padding: "8px 20px",
          },
          sizeSmall: {
            padding: "4px 12px",
            fontSize: "0.8125rem",
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
            borderRadius: 16,
            border: `1px solid ${t.divider}`,
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            fontWeight: 500,
          },
        },
      },
      MuiTextField: {
        defaultProps: { variant: "outlined", size: "small" },
        styleOverrides: {
          root: {
            "& .MuiOutlinedInput-root": {
              borderRadius: 10,
            },
          },
        },
      },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 10,
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: "none",
            fontWeight: 500,
            minHeight: 44,
          },
        },
      },
      MuiTabs: {
        styleOverrides: {
          indicator: {
            height: 3,
            borderRadius: "3px 3px 0 0",
          },
        },
      },
      MuiSwitch: {
        styleOverrides: {
          root: {
            padding: 6,
          },
        },
      },
      MuiAppBar: {
        defaultProps: { elevation: 0 },
        styleOverrides: {
          root: {
            backgroundColor: t.paper,
            borderBottom: `1px solid ${t.divider}`,
          },
        },
      },
      MuiDrawer: {
        styleOverrides: {
          paper: {
            backgroundColor: t.paper,
            borderRight: `1px solid ${t.divider}`,
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 16,
            border: `1px solid ${t.divider}`,
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
          },
        },
      },
    },
  };

  return createTheme(options);
}
