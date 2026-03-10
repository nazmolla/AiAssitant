/**
 * Component render tests — covers all components that previously had no tests.
 *
 * Tests that each component renders without throwing and shows expected content.
 * Uses realistic fetch mocks for each component's API calls.
 *
 * Components tested:
 * - LlmConfig
 * - ChannelsConfig
 * - AuthConfig
 * - UserManagement
 * - CustomToolsConfig
 * - LoggingConfig
 * - WhisperConfig
 * - ChatPanel
 * - NotificationBell
 * - KnowledgeVault
 * - ApiKeysConfig
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, act, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom";

// ── Common mocks ──────────────────────────────────────────────────

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("next-auth/react", () => ({
  useSession: jest.fn(() => ({
    data: { user: { email: "admin@test.com", id: "admin-1", role: "admin" }, expires: "2099-01-01" },
    status: "authenticated",
  })),
  signOut: jest.fn(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@/components/theme-provider", () => ({
  useTheme: () => ({
    theme: "ember", setTheme: jest.fn(),
    font: "inter", setFont: jest.fn(),
    timezone: "UTC", setTimezone: jest.fn(),
    formatDate: (d: string) => d,
  }),
  THEMES: [{ id: "ember", label: "Ember", description: "Bold red", swatch: "hsl(0 85% 60%)" }],
  FONTS: [{ id: "inter", label: "Inter", description: "Default", preview: "'Inter', sans-serif" }],
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ── Restore fetch after each test ────────────────────────────────

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════
// LlmConfig
// ═══════════════════════════════════════════════════════════════════

describe("LlmConfig", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/api/config/llm")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { id: "p1", provider: "azure_openai", label: "Azure GPT-4", model: "gpt-4", endpoint: "https://example.openai.azure.com", api_key: "sk-***", is_default: 1, config: { deployment: "gpt-4", apiVersion: "2024-02-01" } },
          ]),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  test("renders without throwing", async () => {
    const { LlmConfig } = await import("@/components/llm-config");
    expect(() => render(<LlmConfig />)).not.toThrow();
  });

  test("shows 'Add LLM Provider' heading after load", async () => {
    const { LlmConfig } = await import("@/components/llm-config");
    render(<LlmConfig />);
    await waitFor(() => {
      expect(screen.getByText("Add LLM Provider")).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// ChannelsConfig
// ═══════════════════════════════════════════════════════════════════

describe("ChannelsConfig", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/api/config/channels")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  test("renders without throwing", async () => {
    const { ChannelsConfig } = await import("@/components/channels-config");
    expect(() => render(<ChannelsConfig />)).not.toThrow();
  });

  test("shows empty state message after load", async () => {
    const { ChannelsConfig } = await import("@/components/channels-config");
    render(<ChannelsConfig />);
    await waitFor(() => {
      expect(screen.getByText("No channels connected")).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// AuthConfig
// ═══════════════════════════════════════════════════════════════════

describe("AuthConfig", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/api/config/auth")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
        });
      }
      if (url.includes("/api/config/api-keys")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  test("renders without throwing", async () => {
    const { AuthConfig } = await import("@/components/auth-config");
    expect(() => render(<AuthConfig />)).not.toThrow();
  });

  test("shows OAuth Providers heading after load", async () => {
    const { AuthConfig } = await import("@/components/auth-config");
    await act(async () => {
      render(<AuthConfig />);
    });
    await waitFor(() => {
      expect(screen.getByText("OAuth Providers")).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// UserManagement
// ═══════════════════════════════════════════════════════════════════

describe("UserManagement", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/api/admin/users") && !url.includes("/me")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([
            { id: "u1", email: "user@test.com", display_name: "Test User", role: "user", provider_id: "local", created_at: "2024-01-01T00:00:00Z", permissions: { chat: 1, knowledge: 1, dashboard: 1, mcp_servers: 1, channels: 1, llm_config: 1, screen_sharing: 1 } },
          ]),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  test("renders without throwing", async () => {
    const { UserManagement } = await import("@/components/user-management");
    expect(() => render(<UserManagement />)).not.toThrow();
  });

  test("shows user info after load", async () => {
    const { UserManagement } = await import("@/components/user-management");
    await act(async () => {
      render(<UserManagement />);
    });
    await waitFor(() => {
      expect(screen.getAllByText("Test User").length).toBeGreaterThanOrEqual(1);
    }, { timeout: 3000 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// CustomToolsConfig
// ═══════════════════════════════════════════════════════════════════

describe("CustomToolsConfig", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/api/config/custom-tools")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  test("renders without throwing", async () => {
    const { CustomToolsConfig } = await import("@/components/custom-tools-config");
    expect(() => render(<CustomToolsConfig />)).not.toThrow();
  });

  test("shows 'Self-Extending Tools' heading after load", async () => {
    const { CustomToolsConfig } = await import("@/components/custom-tools-config");
    render(<CustomToolsConfig />);
    await waitFor(() => {
      expect(screen.getByText("Self-Extending Tools")).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// LoggingConfig
// ═══════════════════════════════════════════════════════════════════

describe("LoggingConfig", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/api/config/logging")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            log_level: "info",
            retention_days: 30,
            file_logging: true,
            console_logging: true,
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  test("renders without throwing", async () => {
    const { LoggingConfig } = await import("@/components/logging-config");
    expect(() => render(<LoggingConfig />)).not.toThrow();
  });

  test("shows logging headings after load", async () => {
    const { LoggingConfig } = await import("@/components/logging-config");
    render(<LoggingConfig />);
    await waitFor(() => {
      expect(screen.getByText("Server Logging Policy")).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// WhisperConfig
// ═══════════════════════════════════════════════════════════════════

describe("WhisperConfig", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/api/config/whisper")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            enabled: false,
            endpoint: "http://localhost:9000",
            model: "base",
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  test("renders without throwing", async () => {
    const { WhisperConfig } = await import("@/components/whisper-config");
    expect(() => render(<WhisperConfig />)).not.toThrow();
  });

  test("shows whisper headings after load", async () => {
    const { WhisperConfig } = await import("@/components/whisper-config");
    render(<WhisperConfig />);
    await waitFor(() => {
      expect(screen.getByText("Local Whisper Server")).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// NotificationBell
// ═══════════════════════════════════════════════════════════════════

describe("NotificationBell", () => {
  beforeEach(() => {
    jest.useFakeTimers({ advanceTimers: true });
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/api/notifications")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ notifications: [], approvals: [], unreadCount: 0 }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("renders without throwing", async () => {
    const { NotificationBell } = await import("@/components/notification-bell");
    await act(async () => {
      expect(() => render(<NotificationBell />)).not.toThrow();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// KnowledgeVault
// ═══════════════════════════════════════════════════════════════════

describe("KnowledgeVault", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/api/knowledge")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ data: [], total: 0, limit: 100, offset: 0, hasMore: false }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  test("renders without throwing", async () => {
    const { KnowledgeVault } = await import("@/components/knowledge-vault");
    expect(() => render(<KnowledgeVault />)).not.toThrow();
  });

  test("shows knowledge vault heading", async () => {
    const { KnowledgeVault } = await import("@/components/knowledge-vault");
    render(<KnowledgeVault />);
    await waitFor(() => {
      expect(screen.getByText("Knowledge Vault")).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// ChatPanel
// ═══════════════════════════════════════════════════════════════════

// ChatPanel is tested via the full-navigation.test.tsx (opening the Chat tab).
// Direct import testing is skipped because chat-panel.tsx imports markdown-message.tsx
// which uses react-markdown (ESM-only module not supported by Jest's CJS transform).
// The page.test.tsx tests already verify ChatPanel renders via mocked dynamic imports.

// ═══════════════════════════════════════════════════════════════════
// ApiKeysConfig
// ═══════════════════════════════════════════════════════════════════

describe("ApiKeysConfig", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/api/config/api-keys")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  test("renders without throwing", async () => {
    const { ApiKeysConfig } = await import("@/components/api-keys-config");
    expect(() => render(<ApiKeysConfig />)).not.toThrow();
  });

  test("shows new API key button after load", async () => {
    const { ApiKeysConfig } = await import("@/components/api-keys-config");
    await act(async () => {
      render(<ApiKeysConfig />);
    });
    await waitFor(() => {
      expect(screen.getByText("+ New API Key")).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});

// ═══════════════════════════════════════════════════════════════════
// SchedulerConfig
// ═══════════════════════════════════════════════════════════════════

describe("SchedulerConfig", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes("/api/config/scheduler")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            cron_schedule: "*/15 * * * *",
            knowledge_maintenance: {
              enabled: true,
              hour: 20,
              minute: 0,
              poll_seconds: 60,
            },
          }),
        });
      }
      if (url.includes("/api/scheduler/overview")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            schedules_total: 1,
            schedules_active: 1,
            schedules_paused: 0,
            runs_running: 0,
            runs_failed_24h: 0,
            runs_success_24h: 3,
            runs_partial_24h: 0,
          }),
        });
      }
      if (url.includes("/api/scheduler/schedules")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: [
              {
                id: "sched-1",
                schedule_key: "legacy.task.1",
                name: "Legacy Task",
                trigger_type: "interval",
                trigger_expr: "every:1:hour",
                status: "active",
                next_run_at: "2025-01-01T00:00:00Z",
                last_run_at: null,
                updated_at: "2025-01-01T00:00:00Z",
              },
            ],
            total: 1,
            hasMore: false,
          }),
        });
      }
      if (url.includes("/api/scheduler/schedules/sched-1")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            schedule: {
              id: "sched-1",
              schedule_key: "legacy.task.1",
              name: "Legacy Task",
              trigger_type: "interval",
              trigger_expr: "every:1:hour",
              status: "active",
              next_run_at: "2025-01-01T00:00:00Z",
              last_run_at: null,
              updated_at: "2025-01-01T00:00:00Z",
            },
            tasks: [
              {
                id: "task-1",
                schedule_id: "sched-1",
                task_key: "legacy.task.1.child",
                name: "Legacy Child",
                description: null,
                handler_name: "system.legacy.child",
                sequence_no: 1,
                execution_mode: "sequential",
                timeout_ms: null,
                retry_count: 0,
                retry_backoff_ms: null,
                overlap_policy: "skip",
                enabled: 1,
                metadata_json: null,
                created_at: "2025-01-01T00:00:00Z",
                updated_at: "2025-01-01T00:00:00Z",
              },
            ],
            recent_runs: [
              {
                id: "run-1",
                schedule_id: "sched-1",
                trigger_source: "timer",
                status: "success",
                created_at: "2025-01-01T00:00:00Z",
                started_at: "2025-01-01T00:01:00Z",
                finished_at: "2025-01-01T00:01:30Z",
                error_message: null,
              },
            ],
          }),
        });
      }
      if (url.includes("/api/scheduler/runs")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            data: [
              {
                id: "run-1",
                schedule_id: "sched-1",
                trigger_source: "timer",
                status: "success",
                created_at: "2025-01-01T00:00:00Z",
                started_at: "2025-01-01T00:01:00Z",
                finished_at: "2025-01-01T00:01:30Z",
                error_message: null,
              },
            ],
            total: 1,
            hasMore: false,
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  test("renders without throwing", async () => {
    const { SchedulerConfig } = await import("@/components/scheduler-config");
    expect(() => render(<SchedulerConfig />)).not.toThrow();
  });

  test("shows scheduler console heading", async () => {
    const { SchedulerConfig } = await import("@/components/scheduler-config");
    render(<SchedulerConfig />);
    await waitFor(() => {
      expect(screen.getByText("Scheduler Console")).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  test("shows header tasks grid title", async () => {
    const { SchedulerConfig } = await import("@/components/scheduler-config");
    render(<SchedulerConfig />);
    await waitFor(() => {
      expect(screen.getByText("Header Tasks")).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});
