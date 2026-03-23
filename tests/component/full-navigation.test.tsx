/**
 * Comprehensive UI navigation tests — covers EVERY page in the application.
 *
 * Tests:
 * 1. All 5 main tabs (Chat, Conversation, Dashboard, Knowledge, Settings)
 * 2. All 11 settings sub-pages via chip click AND via URL routing
 * 3. URL-based routing (the usePathname → tab/settings mapping)
 * 4. Loading-state guard (prevents premature redirect before permissions load)
 * 5. Permission-gated pages visibility
 * 6. Admin-only pages visibility
 * 7. Drawer navigation
 * 8. Theme switcher rendering
 * 9. Sign-out button
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, act, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";

// ── Configurable mocks ──────────────────────────────────────────

let mockPathname = "/";
const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => mockPathname,
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

// Admin user with ALL permissions
const adminFetch = jest.fn().mockImplementation((url: string) => {
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
          chat: 1, knowledge: 1, dashboard: 1,
          mcp_servers: 1, channels: 1, llm_config: 1, screen_sharing: 1,
        },
      }),
    });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
});
global.fetch = adminFetch;

// Stub all lazy-loaded components with testid markers
jest.mock("@/components/chat-panel", () => ({ ChatPanel: () => <div data-testid="chat-panel">Chat Panel</div> }));
jest.mock("@/components/conversation-mode", () => ({ ConversationMode: () => <div data-testid="conversation-mode">Conversation Mode</div> }));
jest.mock("@/components/notification-bell", () => ({ NotificationBell: () => <div data-testid="notification-bell">Notification Bell</div> }));
jest.mock("@/components/knowledge-vault", () => ({ KnowledgeVault: () => <div data-testid="knowledge-vault">Knowledge Vault</div> }));
jest.mock("@/components/agent-dashboard", () => ({ AgentDashboard: () => <div data-testid="agent-dashboard">Agent Dashboard</div> }));
jest.mock("@/components/mcp-config", () => ({ McpConfig: () => <div data-testid="mcp-config">MCP Config</div> }));
jest.mock("@/components/llm-config", () => ({ LlmConfig: () => <div data-testid="llm-config">LLM Config</div> }));
jest.mock("@/components/channels-config", () => ({ ChannelsConfig: () => <div data-testid="channels-config">Channels Config</div> }));
jest.mock("@/components/profile-config", () => ({ ProfileConfig: () => <div data-testid="profile-config">Profile Config</div> }));
jest.mock("@/components/user-management", () => ({ UserManagement: () => <div data-testid="user-management">UserMgmt Stub</div> }));
jest.mock("@/components/auth-config", () => ({ AuthConfig: () => <div data-testid="auth-config">AuthConfig Stub</div> }));
jest.mock("@/components/tool-policies", () => ({ ToolPolicies: () => <div data-testid="tool-policies">ToolPolicies Stub</div> }));
jest.mock("@/components/custom-tools-config", () => ({ CustomToolsConfig: () => <div data-testid="custom-tools-config">CustomTools Stub</div> }));
jest.mock("@/components/logging-config", () => ({ LoggingConfig: () => <div data-testid="logging-config">LoggingConfig Stub</div> }));
jest.mock("@/components/whisper-config", () => ({ WhisperConfig: () => <div data-testid="whisper-config">WhisperConfig Stub</div> }));
jest.mock("@/components/scheduler-config", () => ({ SchedulerConfig: () => <div data-testid="scheduler-config"><h3>Batch Scheduling</h3></div> }));
jest.mock("@/components/scheduler-console", () => ({ SchedulerConsole: () => <div data-testid="scheduler-console">SchedulerConsole Stub</div> }));


import HomePage from "@/app/[[...path]]/page";

// ── Helpers ──────────────────────────────────────────────────────

async function renderAndWait(pathname = "/chat") {
  mockPathname = pathname;
  const result = render(<HomePage />);
  await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
  return result;
}

async function openDrawer() {
  const menuButton = screen.getByTestId("MenuIcon").closest("button");
  if (menuButton) fireEvent.click(menuButton);
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
}

async function clickDrawerItem(label: string) {
  await openDrawer();
  const allTexts = screen.getAllByText(label);
  const item = allTexts.find((el) => el.closest("[role='button']") || el.closest("li"));
  if (item) {
    const clickTarget = item.closest("[role='button']") || item;
    fireEvent.click(clickTarget);
  }
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
}

async function clickSettingsChip(chipLabel: string) {
  await waitFor(() => {
    expect(screen.getByText(chipLabel)).toBeInTheDocument();
  }, { timeout: 2000 });
  fireEvent.click(screen.getByText(chipLabel));
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
}

// ── Setup / Teardown ─────────────────────────────────────────────

beforeEach(() => {
  mockPathname = "/chat";
  mockPush.mockClear();
  mockReplace.mockClear();
  adminFetch.mockClear();
  global.fetch = adminFetch;
});

afterEach(() => {
  cleanup();
});

// ═══════════════════════════════════════════════════════════════════
// 1. MAIN TAB NAVIGATION — open every main page via drawer
// ═══════════════════════════════════════════════════════════════════

describe("Main Tab Navigation — open every tab via drawer", () => {
  test("Chat tab renders ChatPanel", async () => {
    await renderAndWait("/chat");
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
  });

  test("Dashboard tab renders AgentDashboard", async () => {
    await renderAndWait("/chat");
    await clickDrawerItem("Dashboard");
    expect(screen.getByTestId("agent-dashboard")).toBeInTheDocument();
  });

  test("Conversation tab renders ConversationMode", async () => {
    await renderAndWait("/chat");
    await clickDrawerItem("Conversation");
    expect(screen.getByTestId("conversation-mode")).toBeInTheDocument();
  });

  test("Knowledge tab renders KnowledgeVault", async () => {
    await renderAndWait("/chat");
    await clickDrawerItem("Knowledge");
    expect(screen.getByTestId("knowledge-vault")).toBeInTheDocument();
  });

  test("Settings tab renders SettingsPanel with Providers default", async () => {
    await renderAndWait("/chat");
    await clickDrawerItem("Settings");
    // Providers (LLM) is the default settings sub-page
    await waitFor(() => {
      expect(screen.getByTestId("llm-config")).toBeInTheDocument();
    }, { timeout: 2000 });
  });

});

// ═══════════════════════════════════════════════════════════════════
// 2. URL-BASED ROUTING — every main tab opens via URL
// ═══════════════════════════════════════════════════════════════════

describe("URL-Based Routing — main tabs via URL path", () => {
  test("URL /chat renders ChatPanel", async () => {
    await renderAndWait("/chat");
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
  });

  test("URL /dashboard renders AgentDashboard", async () => {
    await renderAndWait("/dashboard");
    expect(screen.getByTestId("agent-dashboard")).toBeInTheDocument();
  });

  test("URL /conversation renders ConversationMode", async () => {
    await renderAndWait("/conversation");
    expect(screen.getByTestId("conversation-mode")).toBeInTheDocument();
  });

  test("URL /knowledge renders KnowledgeVault", async () => {
    await renderAndWait("/knowledge");
    expect(screen.getByTestId("knowledge-vault")).toBeInTheDocument();
  });

  test("URL /settings renders SettingsPanel", async () => {
    await renderAndWait("/settings");
    await waitFor(() => {
      expect(screen.getByTestId("llm-config")).toBeInTheDocument();
    }, { timeout: 2000 });
  });

});

// ═══════════════════════════════════════════════════════════════════
// 3. SETTINGS SUB-PAGES — open every settings page via chip click
// ═══════════════════════════════════════════════════════════════════

describe("Settings Sub-Pages — open every page via chip click", () => {
  async function navigateToSettings() {
    await renderAndWait("/settings");
    // Wait for permissions to load and chips to appear
    await waitFor(() => {
      expect(screen.getByText("🤖 Providers")).toBeInTheDocument();
    }, { timeout: 2000 });
  }

  test("Profile page renders ProfileConfig via URL (hidden from chips)", async () => {
    await renderAndWait("/settings/profile");
    await waitFor(() => {
      expect(screen.getByTestId("profile-config")).toBeInTheDocument();
    }, { timeout: 2000 });
    expect(screen.getByText("Owner Profile")).toBeInTheDocument();
  });

  test("Providers (LLM) page renders LlmConfig", async () => {
    await navigateToSettings();
    await clickSettingsChip("🤖 Providers");
    expect(screen.getByTestId("llm-config")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "LLM Providers" })).toBeInTheDocument();
  });

  test("Channels page renders ChannelsConfig", async () => {
    await navigateToSettings();
    await clickSettingsChip("📡 Channels");
    expect(screen.getByTestId("channels-config")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Communication Channels" })).toBeInTheDocument();
  });

  test("MCP Servers page renders McpConfig", async () => {
    await navigateToSettings();
    await clickSettingsChip("🔌 MCP Servers");
    expect(screen.getByTestId("mcp-config")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "MCP Servers" })).toBeInTheDocument();
  });

  test("Tool Policies page renders ToolPolicies", async () => {
    await navigateToSettings();
    await clickSettingsChip("🛡️ Tool Policies");
    expect(screen.getByTestId("tool-policies")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tool Policies" })).toBeInTheDocument();
  });

  test("Local Whisper page renders WhisperConfig (admin only)", async () => {
    await navigateToSettings();
    await clickSettingsChip("🎤 Local Whisper");
    expect(screen.getByTestId("whisper-config")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Local Whisper" })).toBeInTheDocument();
  });

  test("Logging page renders LoggingConfig", async () => {
    await navigateToSettings();
    await clickSettingsChip("🧾 Logging");
    expect(screen.getByTestId("logging-config")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Logging" })).toBeInTheDocument();
  });

  test("Custom Tools page renders CustomToolsConfig (admin only)", async () => {
    await navigateToSettings();
    await clickSettingsChip("🔧 Custom Tools");
    expect(screen.getByTestId("custom-tools-config")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Custom Tools" })).toBeInTheDocument();
  });

  test("Authentication page renders AuthConfig (admin only)", async () => {
    await navigateToSettings();
    await clickSettingsChip("🔐 Authentication");
    expect(screen.getByTestId("auth-config")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Authentication" })).toBeInTheDocument();
  });

  test("Users page renders UserManagement (admin only)", async () => {
    await navigateToSettings();
    await clickSettingsChip("👥 Users");
    expect(screen.getByTestId("user-management")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "User Management" })).toBeInTheDocument();
  });

  test("Scheduler page renders SchedulerConfig (admin only)", async () => {
    await navigateToSettings();
    await clickSettingsChip("⏱️ Batch Scheduler");
    expect(screen.getByTestId("scheduler-config")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Batch Scheduling" })).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. SETTINGS URL-BASED ROUTING — open every settings page via URL
//    This is the critical regression test for the redirect-during-load bug.
// ═══════════════════════════════════════════════════════════════════

describe("Settings URL-Based Routing — open every settings page directly via URL", () => {
  test("URL /settings/profile loads Profile page (hidden from chips)", async () => {
    await renderAndWait("/settings/profile");
    await waitFor(() => {
      expect(screen.getByTestId("profile-config")).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  test("URL /settings/llm loads LLM Providers page", async () => {
    await renderAndWait("/settings/llm");
    await waitFor(() => {
      expect(screen.getByTestId("llm-config")).toBeInTheDocument();
    }, { timeout: 2000 });
    expect(screen.getByText("LLM Providers")).toBeInTheDocument();
  });

  test("URL /settings/channels loads Channels page", async () => {
    await renderAndWait("/settings/channels");
    await waitFor(() => {
      expect(screen.getByTestId("channels-config")).toBeInTheDocument();
    }, { timeout: 2000 });
    expect(screen.getByText("Communication Channels")).toBeInTheDocument();
  });

  test("URL /settings/mcp loads MCP Servers page", async () => {
    await renderAndWait("/settings/mcp");
    await waitFor(() => {
      expect(screen.getByTestId("mcp-config")).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  test("URL /settings/policies loads Tool Policies page", async () => {
    await renderAndWait("/settings/policies");
    await waitFor(() => {
      expect(screen.getByTestId("tool-policies")).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  test("URL /settings/whisper loads Whisper page (admin)", async () => {
    await renderAndWait("/settings/whisper");
    await waitFor(() => {
      expect(screen.getByTestId("whisper-config")).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  test("URL /settings/logging loads Logging page", async () => {
    await renderAndWait("/settings/logging");
    await waitFor(() => {
      expect(screen.getByTestId("logging-config")).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  test("URL /settings/custom-tools loads Custom Tools page (admin)", async () => {
    await renderAndWait("/settings/custom-tools");
    await waitFor(() => {
      expect(screen.getByTestId("custom-tools-config")).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  test("URL /settings/auth loads Authentication page (admin)", async () => {
    await renderAndWait("/settings/auth");
    await waitFor(() => {
      expect(screen.getByTestId("auth-config")).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  test("URL /settings/users loads Users page (admin)", async () => {
    await renderAndWait("/settings/users");
    await waitFor(() => {
      expect(screen.getByTestId("user-management")).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  test("URL /settings/scheduler loads Scheduler page (admin)", async () => {
    await renderAndWait("/settings/scheduler");
    await waitFor(() => {
      expect(screen.getByTestId("scheduler-config")).toBeInTheDocument();
    }, { timeout: 2000 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. LOADING-STATE GUARD — prevents redirect before perms load
//    Regression test for the URL routing bug
// ═══════════════════════════════════════════════════════════════════

describe("Loading-State Guard — no premature redirect", () => {
  test("navigating to /settings/llm does NOT redirect while permissions are loading", async () => {
    // Simulate a slow API response
    let resolvePerms: (value: unknown) => void;
    const slowFetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/api/config/profile")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ display_name: "Admin" }) });
      }
      if (url.includes("/api/admin/users/me")) {
        return new Promise((resolve) => {
          resolvePerms = () => resolve({
            ok: true,
            json: () => Promise.resolve({
              role: "admin",
              provider_id: "local",
              permissions: {
                chat: 1, knowledge: 1, dashboard: 1,
                mcp_servers: 1, channels: 1, llm_config: 1, screen_sharing: 1,
              },
            }),
          });
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    global.fetch = slowFetch;

    mockPathname = "/settings/llm";
    render(<HomePage />);

    // During loading, router.push should NOT have been called to redirect away
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const redirectCalls = mockPush.mock.calls.filter(
      ([url]: [string]) => url.includes("/settings/profile")
    );
    expect(redirectCalls.length).toBe(0);

    // Now resolve the permissions
    resolvePerms!(undefined);
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });

    // LLM config should be visible, NOT redirected to profile
    expect(screen.getByTestId("llm-config")).toBeInTheDocument();
  });

  test("navigating to /settings/channels does NOT redirect while permissions are loading", async () => {
    let resolvePerms: (value: unknown) => void;
    const slowFetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/api/config/profile")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ display_name: "Admin" }) });
      }
      if (url.includes("/api/admin/users/me")) {
        return new Promise((resolve) => {
          resolvePerms = () => resolve({
            ok: true,
            json: () => Promise.resolve({
              role: "admin",
              provider_id: "local",
              permissions: {
                chat: 1, knowledge: 1, dashboard: 1,
                mcp_servers: 1, channels: 1, llm_config: 1, screen_sharing: 1,
              },
            }),
          });
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    global.fetch = slowFetch;

    mockPathname = "/settings/channels";
    render(<HomePage />);

    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const redirectCalls = mockPush.mock.calls.filter(
      ([url]: [string]) => url.includes("/settings/profile")
    );
    expect(redirectCalls.length).toBe(0);

    resolvePerms!(undefined);
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    expect(screen.getByTestId("channels-config")).toBeInTheDocument();
  });

  test("navigating to /settings/auth does NOT redirect while role is loading (admin-only page)", async () => {
    let resolvePerms: (value: unknown) => void;
    const slowFetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/api/config/profile")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ display_name: "Admin" }) });
      }
      if (url.includes("/api/admin/users/me")) {
        return new Promise((resolve) => {
          resolvePerms = () => resolve({
            ok: true,
            json: () => Promise.resolve({
              role: "admin",
              provider_id: "local",
              permissions: {
                chat: 1, knowledge: 1, dashboard: 1,
                mcp_servers: 1, channels: 1, llm_config: 1, screen_sharing: 1,
              },
            }),
          });
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    global.fetch = slowFetch;

    mockPathname = "/settings/auth";
    render(<HomePage />);

    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    const redirectCalls = mockPush.mock.calls.filter(
      ([url]: [string]) => url.includes("/settings/profile")
    );
    expect(redirectCalls.length).toBe(0);

    resolvePerms!(undefined);
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });
    expect(screen.getByTestId("auth-config")).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. PERMISSION-GATED VISIBILITY
// ═══════════════════════════════════════════════════════════════════

describe("Permission-Gated Settings Pages", () => {
  test("non-admin user cannot see admin-only settings pages", async () => {
    const nonAdminFetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/api/config/profile")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ display_name: "User" }) });
      }
      if (url.includes("/api/admin/users/me")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            role: "user",
            provider_id: "local",
            permissions: {
              chat: 1, knowledge: 1, dashboard: 1,
              mcp_servers: 1, channels: 1, llm_config: 1, screen_sharing: 1,
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    global.fetch = nonAdminFetch;

    await renderAndWait("/settings");

    // Admin-only chips should NOT be visible
    expect(screen.queryByText("🔧 Custom Tools")).not.toBeInTheDocument();
    expect(screen.queryByText("🔐 Authentication")).not.toBeInTheDocument();
    expect(screen.queryByText("👥 Users")).not.toBeInTheDocument();
    expect(screen.queryByText("🎤 Local Whisper")).not.toBeInTheDocument();

    // Non-admin pages SHOULD be visible
    expect(screen.getByText("🤖 Providers")).toBeInTheDocument();
    expect(screen.getByText("📡 Channels")).toBeInTheDocument();
  });

  test("user without llm_config permission cannot see Providers page", async () => {
    const limitedFetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/api/config/profile")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ display_name: "User" }) });
      }
      if (url.includes("/api/admin/users/me")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            role: "user",
            provider_id: "local",
            permissions: {
              chat: 1, knowledge: 1, dashboard: 1,
              mcp_servers: 1, channels: 1, llm_config: 0, screen_sharing: 1,
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    global.fetch = limitedFetch;

    await renderAndWait("/settings");
    expect(screen.queryByText("🤖 Providers")).not.toBeInTheDocument();
  });

  test("user without channels permission cannot see Channels page", async () => {
    const limitedFetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/api/config/profile")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ display_name: "User" }) });
      }
      if (url.includes("/api/admin/users/me")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            role: "user",
            provider_id: "local",
            permissions: {
              chat: 1, knowledge: 1, dashboard: 1,
              mcp_servers: 1, channels: 0, llm_config: 1, screen_sharing: 1,
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    global.fetch = limitedFetch;

    await renderAndWait("/settings");
    expect(screen.queryByText("📡 Channels")).not.toBeInTheDocument();
  });

  test("user without mcp_servers permission cannot see MCP Servers or Tool Policies", async () => {
    const limitedFetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/api/config/profile")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ display_name: "User" }) });
      }
      if (url.includes("/api/admin/users/me")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            role: "user",
            provider_id: "local",
            permissions: {
              chat: 1, knowledge: 1, dashboard: 1,
              mcp_servers: 0, channels: 1, llm_config: 1, screen_sharing: 1,
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    global.fetch = limitedFetch;

    await renderAndWait("/settings");
    expect(screen.queryByText("🔌 MCP Servers")).not.toBeInTheDocument();
    expect(screen.queryByText("🛡️ Tool Policies")).not.toBeInTheDocument();
  });

  test("admin user can see ALL settings pages", async () => {
    await renderAndWait("/settings");

    const allChips = [
      "🤖 Providers", "📡 Channels", "🔌 MCP Servers",
      "🛡️ Tool Policies", "🎤 Local Whisper", "🧾 Logging",
      "🔧 Custom Tools", "🔐 Authentication", "👥 Users", "⏱️ Batch Scheduler",
    ];
    for (const chipLabel of allChips) {
      await waitFor(() => {
        expect(screen.getByText(chipLabel)).toBeInTheDocument();
      }, { timeout: 2000 });
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. MAIN TAB PERMISSION GATING
// ═══════════════════════════════════════════════════════════════════

describe("Main Tab Permission Gating", () => {
  test("user without dashboard permission cannot see Dashboard tab in drawer", async () => {
    const limitedFetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/api/config/profile")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ display_name: "User" }) });
      }
      if (url.includes("/api/admin/users/me")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            role: "user",
            provider_id: "local",
            permissions: {
              chat: 1, knowledge: 1, dashboard: 0,
              mcp_servers: 1, channels: 1, llm_config: 1, screen_sharing: 1,
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    global.fetch = limitedFetch;

    await renderAndWait("/chat");
    await openDrawer();

    // Dashboard should NOT be in the drawer
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
    // But Chat and Settings should still be there (may appear in chip + drawer)
    expect(screen.getAllByText("Chat").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Settings").length).toBeGreaterThanOrEqual(1);
  });

  test("user without chat permission is redirected to settings", async () => {
    const limitedFetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/api/config/profile")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ display_name: "User" }) });
      }
      if (url.includes("/api/admin/users/me")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            role: "user",
            provider_id: "local",
            permissions: {
              chat: 0, knowledge: 1, dashboard: 1,
              mcp_servers: 1, channels: 1, llm_config: 1, screen_sharing: 1,
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
    global.fetch = limitedFetch;

    mockPathname = "/chat";
    render(<HomePage />);
    await act(async () => { await new Promise((r) => setTimeout(r, 150)); });

    // Should have called router.replace to redirect to /settings
    expect(mockReplace).toHaveBeenCalledWith("/settings");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. UI ELEMENTS (Theme Switcher, Sign Out, etc.)
// ═══════════════════════════════════════════════════════════════════

describe("UI Elements", () => {
  test("Theme switcher button is rendered", async () => {
    await renderAndWait("/chat");
    expect(screen.getByTitle("Change theme")).toBeInTheDocument();
  });

  test("Theme switcher opens menu with theme options on click", async () => {
    await renderAndWait("/chat");
    fireEvent.click(screen.getByTitle("Change theme"));
    await waitFor(() => {
      expect(screen.getByText("Ember")).toBeInTheDocument();
    });
  });

  test("Sign out button is clickable", async () => {
    const { signOut } = jest.requireMock("next-auth/react");
    await renderAndWait("/chat");
    fireEvent.click(screen.getByTitle("Sign out"));
    expect(signOut).toHaveBeenCalled();
  });

  test("Navigation drawer opens and shows all tabs", async () => {
    await renderAndWait("/chat");
    await openDrawer();
    // All main tabs should be visible in the drawer (some may also appear in chip)
    expect(screen.getAllByText("Chat").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Conversation").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Dashboard").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Knowledge").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Settings").length).toBeGreaterThanOrEqual(1);
  });

  test("Header shows active tab chip", async () => {
    await renderAndWait("/chat");
    const chip = screen.getByText("Chat", { selector: ".MuiChip-label" });
    expect(chip).toBeInTheDocument();
  });

  test("Header shows brand name 'Nexus'", async () => {
    await renderAndWait("/chat");
    expect(screen.getByText("Nexus")).toBeInTheDocument();
  });

  test("Header profile button opens profile settings", async () => {
    await renderAndWait("/chat");
    expect(screen.getByText("Admin")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("Open profile settings"));
    expect(mockPush).toHaveBeenCalledWith("/settings/profile");
  });

  test("Header shows online indicator", async () => {
    await renderAndWait("/chat");
    expect(screen.getByTitle("Online")).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. URL REDIRECTS
// ═══════════════════════════════════════════════════════════════════

describe("URL Redirects", () => {
  test("bare / redirects to /chat", async () => {
    mockPathname = "/";
    render(<HomePage />);
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(mockReplace).toHaveBeenCalledWith("/chat");
  });

  test("unknown URL path falls back to chat tab", async () => {
    await renderAndWait("/nonexistent");
    // When path doesn't match any tab, it falls back to "chat"
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. SETTINGS PAGE HEADERS
// ═══════════════════════════════════════════════════════════════════

describe("Settings Page Headers", () => {
  const headersToCheck = [
    { chip: "🤖 Providers", title: "LLM Providers", subtitle: "Centralize Azure OpenAI" },
    { chip: "📡 Channels", title: "Communication Channels", subtitle: "Connect messaging" },
    { chip: "🔌 MCP Servers", title: "MCP Servers", subtitle: "Manage Model Context" },
    { chip: "🛡️ Tool Policies", title: "Tool Policies", subtitle: "Configure approval" },
    { chip: "🎤 Local Whisper", title: "Local Whisper", subtitle: "Deploy and configure" },
    { chip: "🧾 Logging", title: "Logging", subtitle: "Server-wide log levels" },
    { chip: "🔧 Custom Tools", title: "Custom Tools", subtitle: "Agent-created tools" },
    { chip: "🔐 Authentication", title: "Authentication", subtitle: "Configure OAuth" },
    { chip: "👥 Users", title: "User Management", subtitle: "Manage user access" },
    { chip: "⏱️ Batch Scheduler", title: "Batch Scheduler", subtitle: "Configure batch job scheduling" },
  ];

  test.each(headersToCheck)(
    "$chip shows header '$title'",
    async ({ chip, title, subtitle }) => {
      await renderAndWait("/settings");
      await waitFor(() => {
        expect(screen.getByText(chip)).toBeInTheDocument();
      }, { timeout: 2000 });
      fireEvent.click(screen.getByText(chip));
      await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
      expect(screen.getByText(new RegExp(subtitle))).toBeInTheDocument();
    }
  );
});
