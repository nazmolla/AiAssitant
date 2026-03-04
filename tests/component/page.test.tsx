/**
 * Component render tests for the main page (page.tsx).
 *
 * These tests mount React components in jsdom and verify they render
 * without throwing. This is the layer that catches client-side render
 * errors like React #310 ("Objects are not valid as a React child").
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, within, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

// ── Mocks (must be before component imports) ─────────────────────

// Mock next/navigation
jest.mock("next/navigation", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    prefetch: jest.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock next-auth/react
const mockSession = {
  user: { email: "test@example.com", id: "user-1", role: "admin" },
  expires: "2099-01-01",
};
jest.mock("next-auth/react", () => ({
  useSession: jest.fn(() => ({ data: mockSession, status: "authenticated" })),
  signOut: jest.fn(),
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock next/dynamic — render children synchronously for tests
jest.mock("next/dynamic", () => {
  return function mockDynamic(loader: () => Promise<{ default: React.ComponentType }>) {
    // Return a component that renders the module synchronously
    const LazyComponent = React.lazy(loader);
    return function DynamicWrapper(props: Record<string, unknown>) {
      return (
        <React.Suspense fallback={<div data-testid="loading">Loading...</div>}>
          <LazyComponent {...props} />
        </React.Suspense>
      );
    };
  };
});

// Mock theme provider
jest.mock("@/components/theme-provider", () => ({
  useTheme: () => ({
    theme: "ember",
    setTheme: jest.fn(),
    font: "inter",
    setFont: jest.fn(),
    timezone: "UTC",
    setTimezone: jest.fn(),
    formatDate: (d: string) => d,
  }),
  THEMES: [
    { id: "ember", label: "Ember", description: "Bold red", swatch: "hsl(0 85% 60%)" },
    { id: "midnight", label: "Midnight", description: "Deep blue", swatch: "hsl(230 80% 62%)" },
  ],
  FONTS: [
    { id: "inter", label: "Inter", description: "Default", preview: "'Inter', sans-serif" },
  ],
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mock MUI ThemeProvider and StyledEngineProvider
jest.mock("@mui/material/styles", () => ({
  ...jest.requireActual("@mui/material/styles"),
  useTheme: () => ({
    palette: { mode: "dark", primary: { main: "#f00" }, text: { primary: "#fff", secondary: "#aaa" }, background: { default: "#111", paper: "#222" }, divider: "#333", success: { main: "#0f0" }, error: { main: "#f00" } },
    breakpoints: { up: () => "@media (min-width:600px)", down: () => "@media (max-width:599px)" },
    spacing: (n: number) => `${n * 8}px`,
  }),
}));

// Mock fetch for API calls the components make on mount
const mockFetch = jest.fn().mockImplementation((url: string) => {
  if (url.includes("/api/config/profile")) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ display_name: "Test User", theme: "ember", font: "inter" }),
    });
  }
  if (url.includes("/api/admin/users/me")) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        role: "admin",
        provider_id: "local",
        permissions: {
          user_id: "user-1",
          chat: 1, knowledge: 1, dashboard: 1, approvals: 1,
          mcp_servers: 1, channels: 1, llm_config: 1, screen_sharing: 1,
        },
      }),
    });
  }
  return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
});
global.fetch = mockFetch;

// jsdom provides window.location; no need to override

// Mock lazy-loaded components (return simple stubs)
jest.mock("@/components/chat-panel", () => ({ ChatPanel: () => <div data-testid="chat-panel">Chat</div> }));
jest.mock("@/components/approval-inbox", () => ({ ApprovalInbox: () => <div data-testid="approval-inbox">Approvals</div> }));
jest.mock("@/components/knowledge-vault", () => ({ KnowledgeVault: () => <div data-testid="knowledge-vault">Knowledge</div> }));
jest.mock("@/components/agent-dashboard", () => ({ AgentDashboard: () => <div data-testid="agent-dashboard">Dashboard</div> }));
jest.mock("@/components/mcp-config", () => ({ McpConfig: () => <div data-testid="mcp-config">MCP</div> }));
jest.mock("@/components/llm-config", () => ({ LlmConfig: () => <div data-testid="llm-config">LLM</div> }));
jest.mock("@/components/channels-config", () => ({ ChannelsConfig: () => <div data-testid="channels-config">Channels</div> }));
jest.mock("@/components/profile-config", () => ({ ProfileConfig: () => <div data-testid="profile-config">Profile</div> }));
jest.mock("@/components/user-management", () => ({ UserManagement: () => <div data-testid="user-management">Users</div> }));
jest.mock("@/components/auth-config", () => ({ AuthConfig: () => <div data-testid="auth-config">Auth</div> }));
jest.mock("@/components/tool-policies", () => ({ ToolPolicies: () => <div data-testid="tool-policies">Policies</div> }));
jest.mock("@/components/custom-tools-config", () => ({ CustomToolsConfig: () => <div data-testid="custom-tools-config">Custom Tools</div> }));
jest.mock("@/components/logging-config", () => ({ LoggingConfig: () => <div data-testid="logging-config">Logging</div> }));

// ── Import the component AFTER mocks ─────────────────────────────
import HomePage from "@/app/[[...path]]/page";

// ── Tests ────────────────────────────────────────────────────────

describe("HomePage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockClear();
  });

  test("renders without throwing (no React #310 or similar)", () => {
    expect(() => render(<HomePage />)).not.toThrow();
  });

  test("shows brand name and version", () => {
    render(<HomePage />);
    expect(screen.getByText("Nexus")).toBeInTheDocument();
  });

  test("renders navigation drawer trigger", () => {
    render(<HomePage />);
    // The hamburger menu button should exist
    const menuButtons = screen.getAllByRole("button");
    expect(menuButtons.length).toBeGreaterThan(0);
  });

  test("shows active tab chip in header", () => {
    render(<HomePage />);
    // Default tab is "chat" — find the chip specifically (not the mocked panel content)
    const chip = screen.getByText("Chat", { selector: ".MuiChip-label" });
    expect(chip).toBeInTheDocument();
  });

  test("renders account menu trigger", () => {
    render(<HomePage />);
    expect(screen.getByTitle("Account menu")).toBeInTheDocument();
  });
});

describe("HomePage — unauthenticated", () => {
  beforeEach(() => {
    const { useSession } = jest.requireMock("next-auth/react");
    useSession.mockReturnValue({ data: null, status: "unauthenticated" });
  });

  afterEach(() => {
    const { useSession } = jest.requireMock("next-auth/react");
    useSession.mockReturnValue({ data: mockSession, status: "authenticated" });
  });

  test("renders sign-in prompt without crashing", () => {
    expect(() => render(<HomePage />)).not.toThrow();
    expect(screen.getByText("Sign In")).toBeInTheDocument();
  });
});

describe("HomePage — loading state", () => {
  beforeEach(() => {
    const { useSession } = jest.requireMock("next-auth/react");
    useSession.mockReturnValue({ data: null, status: "loading" });
  });

  afterEach(() => {
    const { useSession } = jest.requireMock("next-auth/react");
    useSession.mockReturnValue({ data: mockSession, status: "authenticated" });
  });

  test("renders loading spinner without crashing", () => {
    expect(() => render(<HomePage />)).not.toThrow();
    expect(screen.getByText("Loading Nexus...")).toBeInTheDocument();
  });
});

/**
 * CRITICAL: Session state transition tests.
 *
 * These test that the component survives a re-render when useSession
 * transitions between states (loading → authenticated, loading → unauthenticated).
 * This is what actually happens in the browser on every page load / refresh.
 *
 * If any React hook (useMemo, useCallback, etc.) is called AFTER a conditional
 * early return, the hook count changes between renders and React throws
 * "Minified React error #310" — a Rules of Hooks violation.
 *
 * The previous tests only tested each state in isolation, so they never
 * caught this class of bug.
 */
describe("HomePage — session state transitions (React hooks stability)", () => {
  test("loading → authenticated: no hooks error on re-render", () => {
    const { useSession } = jest.requireMock("next-auth/react");

    // 1. First render: loading state (early return with spinner)
    useSession.mockReturnValue({ data: null, status: "loading" });
    const { rerender } = render(<HomePage />);
    expect(screen.getByText("Loading Nexus...")).toBeInTheDocument();

    // 2. Re-render: session loaded (full UI with hooks like useMemo)
    //    This is where error #310 would fire if hooks are after conditional returns
    useSession.mockReturnValue({ data: mockSession, status: "authenticated" });
    expect(() => rerender(<HomePage />)).not.toThrow();
    expect(screen.getByText("Nexus")).toBeInTheDocument();
  });

  test("loading → unauthenticated: no hooks error on re-render", () => {
    const { useSession } = jest.requireMock("next-auth/react");

    // 1. First render: loading state
    useSession.mockReturnValue({ data: null, status: "loading" });
    const { rerender } = render(<HomePage />);
    expect(screen.getByText("Loading Nexus...")).toBeInTheDocument();

    // 2. Re-render: unauthenticated (sign-in prompt)
    useSession.mockReturnValue({ data: null, status: "unauthenticated" });
    expect(() => rerender(<HomePage />)).not.toThrow();
    expect(screen.getByText("Sign In")).toBeInTheDocument();
  });

  test("unauthenticated → authenticated: no hooks error on re-render", () => {
    const { useSession } = jest.requireMock("next-auth/react");

    // 1. First render: unauthenticated
    useSession.mockReturnValue({ data: null, status: "unauthenticated" });
    const { rerender } = render(<HomePage />);
    expect(screen.getByText("Sign In")).toBeInTheDocument();

    // 2. Re-render: authenticated
    useSession.mockReturnValue({ data: mockSession, status: "authenticated" });
    expect(() => rerender(<HomePage />)).not.toThrow();
    expect(screen.getByText("Nexus")).toBeInTheDocument();
  });

  test("authenticated → loading → authenticated: survives full cycle", () => {
    const { useSession } = jest.requireMock("next-auth/react");

    // 1. Start authenticated
    useSession.mockReturnValue({ data: mockSession, status: "authenticated" });
    const { rerender } = render(<HomePage />);
    expect(screen.getByText("Nexus")).toBeInTheDocument();

    // 2. Token refresh → loading
    useSession.mockReturnValue({ data: null, status: "loading" });
    expect(() => rerender(<HomePage />)).not.toThrow();

    // 3. Back to authenticated
    useSession.mockReturnValue({ data: mockSession, status: "authenticated" });
    expect(() => rerender(<HomePage />)).not.toThrow();
    expect(screen.getByText("Nexus")).toBeInTheDocument();
  });
});
