/**
 * Component render tests for the Settings panel within page.tsx.
 *
 * Tests that the settings chip navigation and all sub-pages render
 * without throwing React #310 or similar errors.
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

// ── Mocks ────────────────────────────────────────────────────────

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const mockSession = {
  user: { email: "admin@example.com", id: "admin-1", role: "admin" },
  expires: "2099-01-01",
};
jest.mock("next-auth/react", () => ({
  useSession: jest.fn(() => ({ data: mockSession, status: "authenticated" })),
  signOut: jest.fn(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("next/dynamic", () => {
  return function mockDynamic(loader: () => Promise<{ default: React.ComponentType }>) {
    const LazyComponent = React.lazy(loader);
    return function DynamicWrapper(props: Record<string, unknown>) {
      return (
        <React.Suspense fallback={<div>Loading...</div>}>
          <LazyComponent {...props} />
        </React.Suspense>
      );
    };
  };
});

jest.mock("@/components/theme-provider", () => ({
  useTheme: () => ({
    theme: "ember", setTheme: jest.fn(),
    font: "inter", setFont: jest.fn(),
    timezone: "UTC", setTimezone: jest.fn(),
    formatDate: (d: string) => d,
  }),
  THEMES: [
    { id: "ember", label: "Ember", description: "Bold red", swatch: "hsl(0 85% 60%)" },
  ],
  FONTS: [{ id: "inter", label: "Inter", description: "Default", preview: "'Inter', sans-serif" }],
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock fetch — admin user with all permissions
global.fetch = jest.fn().mockImplementation((url: string) => {
  if (url.includes("/api/config/profile")) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ display_name: "Admin" }) });
  }
  if (url.includes("/api/admin/users/me")) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        role: "admin",
        provider_id: "local",
        permissions: {
          user_id: "admin-1",
          chat: 1, knowledge: 1, dashboard: 1, approvals: 1,
          mcp_servers: 1, channels: 1, llm_config: 1, screen_sharing: 1,
        },
      }),
    });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
});

// jsdom provides window.location; no need to override

// Stub all lazy-loaded settings sub-pages
jest.mock("@/components/chat-panel", () => ({ ChatPanel: () => <div>Chat</div> }));
jest.mock("@/components/approval-inbox", () => ({ ApprovalInbox: () => <div>Approvals</div> }));
jest.mock("@/components/knowledge-vault", () => ({ KnowledgeVault: () => <div>Knowledge</div> }));
jest.mock("@/components/agent-dashboard", () => ({ AgentDashboard: () => <div>Dashboard</div> }));
jest.mock("@/components/mcp-config", () => ({ McpConfig: () => <div data-testid="mcp">MCP Config</div> }));
jest.mock("@/components/llm-config", () => ({ LlmConfig: () => <div data-testid="llm">LLM Config</div> }));
jest.mock("@/components/channels-config", () => ({ ChannelsConfig: () => <div data-testid="channels">Channels Config</div> }));
jest.mock("@/components/profile-config", () => ({ ProfileConfig: () => <div data-testid="profile">Profile Config</div> }));
jest.mock("@/components/user-management", () => ({ UserManagement: () => <div data-testid="users">User Management</div> }));
jest.mock("@/components/auth-config", () => ({ AuthConfig: () => <div data-testid="auth">Auth Config</div> }));
jest.mock("@/components/tool-policies", () => ({ ToolPolicies: () => <div data-testid="policies">Tool Policies</div> }));
jest.mock("@/components/custom-tools-config", () => ({ CustomToolsConfig: () => <div data-testid="custom-tools">Custom Tools</div> }));
jest.mock("@/components/logging-config", () => ({ LoggingConfig: () => <div data-testid="logging">Logging Config</div> }));
jest.mock("@/components/alexa-config", () => ({ AlexaConfig: () => <div data-testid="alexa">Alexa Config</div> }));
jest.mock("@/components/whisper-config", () => ({ WhisperConfig: () => <div data-testid="whisper">Whisper Config</div> }));
jest.mock("@/components/scheduler-config", () => ({ SchedulerConfig: () => <div data-testid="scheduler">Scheduler Config</div> }));

import HomePage from "@/app/[[...path]]/page";

// ── Helper: navigate to Settings tab ─────────────────────────────

async function renderSettingsPanel() {
  const result = render(<HomePage />);

  // Wait for fetch to complete and state to update
  await act(async () => {
    await new Promise((r) => setTimeout(r, 100));
  });

  // Open the nav drawer by clicking the hamburger menu
  const menuButton = screen.getByTestId("MenuIcon").closest("button");
  if (menuButton) {
    fireEvent.click(menuButton);
  }

  // Wait briefly for drawer animation
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });

  // Click "Settings" in the nav drawer
  const allSettingsTexts = screen.getAllByText("Settings");
  // The nav item is inside a ListItemButton
  const settingsNavItem = allSettingsTexts.find(
    (el) => el.closest("[role='button']") || el.closest("li")
  );
  if (settingsNavItem) {
    const clickTarget = settingsNavItem.closest("[role='button']") || settingsNavItem;
    fireEvent.click(clickTarget);
  }

  // Wait for tab switch
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50));
  });

  return result;
}

// ── Tests ────────────────────────────────────────────────────────

describe("SettingsPanel — chip navigation rendering", () => {
  const SETTINGS_LABELS = [
    "🤖 Providers",
    "📡 Channels",
    "🔌 MCP Servers",
    "🛡️ Tool Policies",
    "🧾 Logging",
    "🔧 Custom Tools",
    "🔐 Authentication",
    "👥 Users",
    "🔊 Alexa",
    "⏱️ Batch Scheduler",
  ];

  test("renders all settings chips without throwing (React #310 regression)", async () => {
    await renderSettingsPanel();

    // All settings chip labels should be present (admin sees all)
    for (const label of SETTINGS_LABELS) {
      await waitFor(() => {
        expect(screen.getByText(label)).toBeInTheDocument();
      }, { timeout: 2000 });
    }
  });

  test("chips with emoji icons do not produce invalid React children", async () => {
    // This specifically guards against the Typography-as-Chip-icon pattern
    // that caused React #310 in production
    const consoleErrors: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      consoleErrors.push(String(args[0]));
    };

    try {
      await renderSettingsPanel();

      // Wait for all chips to render
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });

      const reactChildErrors = consoleErrors.filter(
        (msg) => msg.includes("Objects are not valid as a React child") || msg.includes("#310")
      );
      expect(reactChildErrors).toEqual([]);
    } finally {
      console.error = originalError;
    }
  });

  test("clicking a settings chip switches the active sub-page", async () => {
    await renderSettingsPanel();

    // Wait for chips to render
    await waitFor(() => {
      expect(screen.getByText("🧾 Logging")).toBeInTheDocument();
    }, { timeout: 2000 });

    // Click "Logging" chip
    fireEvent.click(screen.getByText("🧾 Logging"));

    // The Logging header should appear
    await waitFor(() => {
      expect(screen.getByText("Logging")).toBeInTheDocument();
    });
  });

  test("non-admin users do not see admin-only settings chips", async () => {
    // Override to non-admin
    (global.fetch as jest.Mock).mockImplementation((url: string) => {
      if (url.includes("/api/admin/users/me")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            role: "user",
            provider_id: "local",
            permissions: {
              chat: 1, knowledge: 1, dashboard: 1, approvals: 1,
              mcp_servers: 1, channels: 0, llm_config: 0, screen_sharing: 1,
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ display_name: "User" }) });
    });

    render(<HomePage />);

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    // Navigate to settings via drawer
    const menuButton = screen.getByTestId("MenuIcon").closest("button");
    if (menuButton) fireEvent.click(menuButton);
    
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const allSettingsTexts = screen.getAllByText("Settings");
    const settingsNavItem = allSettingsTexts.find(
      (el) => el.closest("[role='button']") || el.closest("li")
    );
    if (settingsNavItem) {
      const clickTarget = settingsNavItem.closest("[role='button']") || settingsNavItem;
      fireEvent.click(clickTarget);
    }

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Admin-only items should NOT be present
    expect(screen.queryByText("🔧 Custom Tools")).not.toBeInTheDocument();
    expect(screen.queryByText("🔐 Authentication")).not.toBeInTheDocument();
    expect(screen.queryByText("👥 Users")).not.toBeInTheDocument();
    expect(screen.queryByText("⏱️ Scheduler")).not.toBeInTheDocument();
  });
});
