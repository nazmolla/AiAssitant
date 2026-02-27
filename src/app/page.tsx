"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ChatPanel } from "@/components/chat-panel";
import { ApprovalInbox } from "@/components/approval-inbox";
import { KnowledgeVault } from "@/components/knowledge-vault";
import { McpConfig } from "@/components/mcp-config";
import { LlmConfig } from "@/components/llm-config";
import { ChannelsConfig } from "@/components/channels-config";
import { ProfileConfig } from "@/components/profile-config";
import { AgentDashboard } from "@/components/agent-dashboard";
import { UserManagement } from "@/components/user-management";
import { AuthConfig } from "@/components/auth-config";
import { ToolPolicies } from "@/components/tool-policies";
import { CustomToolsConfig } from "@/components/custom-tools-config";
import { LoggingConfig } from "@/components/logging-config";
import { useTheme, THEMES, type ThemeId } from "@/components/theme-provider";

export default function HomePage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string>("user");
  const [activeTab, setActiveTab] = useState<string>("chat");
  const [perms, setPerms] = useState<Record<string, number>>({
    chat: 1, knowledge: 1, dashboard: 1, approvals: 1,
    mcp_servers: 1, channels: 0, llm_config: 0, screen_sharing: 1,
  });

  useEffect(() => {
    fetch("/api/config/profile")
      .then((r) => r.json())
      .then((p) => { if (p?.display_name) setDisplayName(p.display_name); })
      .catch(() => {});
    fetch("/api/admin/users/me")
      .then((r) => r.json())
      .then((d) => {
        if (d?.role) setUserRole(d.role);
        if (d?.permissions) setPerms(d.permissions);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!perms.chat && activeTab === "chat") {
      setActiveTab("config");
    }
  }, [perms.chat, activeTab]);

  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-background noise">
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="h-10 w-10 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
            <div className="absolute inset-0 h-10 w-10 rounded-full bg-primary/10 blur-xl animate-pulse-glow" />
          </div>
          <span className="text-sm text-muted-foreground font-light tracking-wide">Loading Nexus...</span>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex h-screen items-center justify-center bg-background noise relative overflow-hidden">
        {/* Background glow orbs */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-primary/3 rounded-full blur-3xl" />

        <div className="text-center space-y-8 relative z-10">
          <div className="space-y-4">
            <h1 className="text-6xl font-display font-bold gradient-text tracking-tight">
              Nexus
            </h1>
            <p className="text-lg text-muted-foreground font-light tracking-wide uppercase">
              The AI that actually does things.
            </p>
          </div>
          <Button
            size="lg"
            className="rounded-2xl px-10 h-12 text-base font-medium glow-md hover:glow-sm"
            onClick={() => router.push("/auth/signin")}
          >
            Sign In
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-background noise">
      {/* Header — Glass morphism toolbar */}
      <header className="glass px-3 sm:px-6 py-3 flex items-center justify-between relative z-20">
        <div className="flex items-center gap-2 sm:gap-4">
          <h1 className="text-lg font-display font-bold gradient-text">Nexus</h1>
          <span className="hidden sm:inline text-[10px] text-muted-foreground/70 bg-primary/5 border border-primary/10 px-2.5 py-1 rounded-full font-medium uppercase tracking-widest">
            Command Center
          </span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <ThemeSwitcher />
          <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" title="Online" />
          <span className="text-[13px] text-muted-foreground font-medium">
            {displayName || session.user?.email}
          </span>
          <button
            onClick={() => signOut({ callbackUrl: `${window.location.origin}/auth/signin` })}
            className="text-xs text-muted-foreground/60 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10"
            title="Sign out"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-col h-full">
          <div className="glass px-2 sm:px-6 py-2 flex items-center justify-start overflow-x-auto">
            <TabsList className="flex-nowrap w-max min-w-max">
              {!!perms.chat && (
                <TabsTrigger value="chat">
                  <span className="mr-0 sm:mr-1.5">💬</span>
                  <span className={activeTab === "chat" ? "inline sm:inline ml-1 sm:ml-0" : "hidden sm:inline"}>Chat</span>
                </TabsTrigger>
              )}
              {!!perms.dashboard && (
                <TabsTrigger value="dashboard">
                  <span className="mr-0 sm:mr-1.5">📊</span>
                  <span className={activeTab === "dashboard" ? "inline sm:inline ml-1 sm:ml-0" : "hidden sm:inline"}>Dashboard</span>
                </TabsTrigger>
              )}
              {!!perms.approvals && (
                <TabsTrigger value="approvals">
                  <span className="mr-0 sm:mr-1.5">✅</span>
                  <span className={activeTab === "approvals" ? "inline sm:inline ml-1 sm:ml-0" : "hidden sm:inline"}>Approvals</span>
                </TabsTrigger>
              )}
              {!!perms.knowledge && (
                <TabsTrigger value="knowledge">
                  <span className="mr-0 sm:mr-1.5">🧠</span>
                  <span className={activeTab === "knowledge" ? "inline sm:inline ml-1 sm:ml-0" : "hidden sm:inline"}>Knowledge</span>
                </TabsTrigger>
              )}
              <TabsTrigger value="config">
                <span className="mr-0 sm:mr-1.5">⚙️</span>
                <span className={activeTab === "config" ? "inline sm:inline ml-1 sm:ml-0" : "hidden sm:inline"}>Settings</span>
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="chat" className="flex-1 overflow-hidden m-0">
            <ChatPanel />
          </TabsContent>

          <TabsContent value="dashboard" className="flex-1 overflow-auto m-0 p-6">
            <div className="max-w-5xl mx-auto">
              <AgentDashboard />
            </div>
          </TabsContent>

          <TabsContent value="approvals" className="flex-1 overflow-auto m-0 p-6">
            <div className="max-w-3xl mx-auto">
              <ApprovalInbox />
            </div>
          </TabsContent>

          <TabsContent value="knowledge" className="flex-1 overflow-auto m-0 p-6">
            <div className="max-w-5xl mx-auto">
              <KnowledgeVault />
            </div>
          </TabsContent>

          <TabsContent value="config" className="flex-1 overflow-hidden m-0">
            <SettingsPanel userRole={userRole} perms={perms} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Settings Panel — left sidebar navigation                                   */
/* -------------------------------------------------------------------------- */

interface SettingsPage {
  key: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
  permKey?: string;
}

const SETTINGS_PAGES: SettingsPage[] = [
  { key: "profile", label: "Profile", icon: "👤" },
  { key: "llm", label: "Providers", icon: "🤖", permKey: "llm_config" },
  { key: "channels", label: "Channels", icon: "📡", permKey: "channels" },
  { key: "mcp", label: "MCP Servers", icon: "🔌", permKey: "mcp_servers" },
  { key: "policies", label: "Tool Policies", icon: "🛡️", permKey: "mcp_servers" },
  { key: "logging", label: "Logging", icon: "🧾", adminOnly: true },
  { key: "custom-tools", label: "Custom Tools", icon: "🔧", adminOnly: true },
  { key: "auth", label: "Authentication", icon: "🔐", adminOnly: true },
  { key: "users", label: "Users", icon: "👥", adminOnly: true },
];

const SETTINGS_HEADERS: Record<string, { title: string; subtitle: string }> = {
  profile: { title: "Owner Profile", subtitle: "Your identity, skills, and contact info. Nexus uses this to personalize responses." },
  llm: { title: "LLM Providers", subtitle: "Centralize Azure OpenAI, OpenAI, and Anthropic credentials." },
  channels: { title: "Communication Channels", subtitle: "Connect messaging platforms so Nexus can chat with you anywhere." },
  mcp: { title: "MCP Servers", subtitle: "Manage Model Context Protocol server connections." },
  policies: { title: "Tool Policies", subtitle: "Configure approval requirements and proactive scanning for each discovered tool." },
  logging: { title: "Logging", subtitle: "Server-wide log levels, retention boundary, and cleanup tools." },
  "custom-tools": { title: "Custom Tools", subtitle: "Agent-created tools that extend Nexus capabilities at runtime." },
  auth: { title: "Authentication Providers", subtitle: "Configure OAuth login providers and external integrations." },
  users: { title: "User Management", subtitle: "Manage user access, roles, and feature permissions." },
};

function SettingsPanel({ userRole, perms }: { userRole: string; perms: Record<string, number> }) {
  const [active, setActive] = useState("profile");

  const visiblePages = SETTINGS_PAGES.filter((p) => {
    if (p.adminOnly && userRole !== "admin") return false;
    if (p.permKey && !perms[p.permKey]) return false;
    return true;
  });

  const header = SETTINGS_HEADERS[active];

  return (
    <div className="flex flex-col sm:flex-row h-full">
      {/* Left sidebar — horizontal scroll on mobile, vertical on desktop */}
      <nav className="sm:w-52 shrink-0 border-b sm:border-b-0 sm:border-r border-white/[0.06] bg-white/[0.01] overflow-x-auto sm:overflow-y-auto py-2 sm:py-4 px-2">
        <div className="flex sm:flex-col gap-1 sm:gap-0.5">
          {visiblePages.map((page) => (
            <button
              key={page.key}
              onClick={() => setActive(page.key)}
              className={`shrink-0 sm:w-full flex items-center gap-2 sm:gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-200 text-left whitespace-nowrap ${
                active === page.key
                  ? "bg-primary/10 text-primary border border-primary/15"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
              }`}
            >
              <span className="text-sm">{page.icon}</span>
              <span className={active === page.key ? "inline sm:inline" : "hidden sm:inline"}>
                {page.label}
              </span>
            </button>
          ))}
        </div>
      </nav>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {header && (
            <div>
              <h2 className="text-2xl font-display font-bold gradient-text">{header.title}</h2>
              <p className="text-sm text-muted-foreground mt-1 font-light">{header.subtitle}</p>
            </div>
          )}

          {active === "profile" && <ProfileConfig />}
          {active === "llm" && <LlmConfig />}
          {active === "channels" && <ChannelsConfig />}
          {active === "mcp" && <McpConfig />}
          {active === "policies" && <ToolPolicies />}
          {active === "logging" && userRole === "admin" && <LoggingConfig />}
          {active === "custom-tools" && userRole === "admin" && <CustomToolsConfig />}
          {active === "auth" && userRole === "admin" && <AuthConfig />}
          {active === "users" && userRole === "admin" && <UserManagement />}
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Theme Switcher — compact dropdown in the header                            */
/* -------------------------------------------------------------------------- */

function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-foreground px-2 py-1.5 rounded-lg hover:bg-white/[0.05] transition-all duration-200"
        title="Change theme"
      >
        <span
          className="h-3 w-3 rounded-full border border-white/20"
          style={{ background: THEMES.find((t) => t.id === theme)?.swatch }}
        />
        <span className="hidden sm:inline">{THEMES.find((t) => t.id === theme)?.label}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-2 z-50 w-52 rounded-xl border border-white/[0.08] bg-card/95 backdrop-blur-xl shadow-2xl p-1.5 space-y-0.5">
            {THEMES.map((t) => (
              <button
                key={t.id}
                onClick={() => { setTheme(t.id); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-all duration-200 ${
                  theme === t.id
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
                }`}
              >
                <span
                  className="h-3.5 w-3.5 rounded-full border border-white/20 shrink-0"
                  style={{ background: t.swatch }}
                />
                <div className="min-w-0">
                  <div className="text-[13px] font-medium">{t.label}</div>
                  <div className="text-[10px] text-muted-foreground/60">{t.description}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
