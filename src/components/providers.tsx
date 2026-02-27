"use client";

import React, { useMemo } from "react";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider as MuiThemeProvider, StyledEngineProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { buildMuiTheme } from "@/lib/mui-theme";

/* ── Error boundary to catch & report client-side errors ── */
class ClientErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Report to server so we can read from journalctl
    fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        level: "error",
        source: "client.error-boundary",
        message: `CLIENT CRASH: ${error.message}`,
        metadata: JSON.stringify({
          stack: error.stack,
          componentStack: info.componentStack,
        }),
      }),
    }).catch(() => {});
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: "monospace", background: "#111", color: "#eee", minHeight: "100vh" }}>
          <h1 style={{ color: "#f44" }}>Client Error</h1>
          <pre style={{ whiteSpace: "pre-wrap", background: "#222", padding: 16, borderRadius: 8 }}>
            {this.state.error.message}
          </pre>
          <pre style={{ whiteSpace: "pre-wrap", color: "#888", fontSize: 12 }}>
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            style={{ marginTop: 16, padding: "8px 24px", fontSize: 16, cursor: "pointer" }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function MuiBridge({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  const muiTheme = useMemo(() => buildMuiTheme(theme), [theme]);

  return (
    <StyledEngineProvider injectFirst>
      <MuiThemeProvider theme={muiTheme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </StyledEngineProvider>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <ThemeProvider>
        <ClientErrorBoundary>
          <MuiBridge>{children}</MuiBridge>
        </ClientErrorBoundary>
      </ThemeProvider>
    </SessionProvider>
  );
}
