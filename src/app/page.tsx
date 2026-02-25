"use client";

import { useEffect, useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
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

export default function HomePage() {
  const { data: session, status } = useSession();
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<string>("user");
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
            onClick={() => signIn()}
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
      <header className="glass px-6 py-3 flex items-center justify-between relative z-20">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-display font-bold gradient-text">Nexus</h1>
          <span className="text-[10px] text-muted-foreground/70 bg-primary/5 border border-primary/10 px-2.5 py-1 rounded-full font-medium uppercase tracking-widest">
            Command Center
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" title="Online" />
          <span className="text-[13px] text-muted-foreground font-medium">
            {displayName || session.user?.email}
          </span>
          <button
            onClick={() => signOut({ redirect: true })}
            className="text-xs text-muted-foreground/60 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10"
            title="Sign out"
          >
            Logout
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        <Tabs defaultValue={perms.chat ? "chat" : "config"} className="flex flex-col h-full">
          <div className="glass px-6 py-2 flex items-center justify-center">
            <TabsList>
              {!!perms.chat && (
                <TabsTrigger value="chat">
                  <span className="mr-1.5">💬</span> Chat
                </TabsTrigger>
              )}
              {!!perms.dashboard && (
                <TabsTrigger value="dashboard">
                  <span className="mr-1.5">📊</span> Dashboard
                </TabsTrigger>
              )}
              {!!perms.approvals && (
                <TabsTrigger value="approvals">
                  <span className="mr-1.5">✅</span> Approvals
                </TabsTrigger>
              )}
              {!!perms.knowledge && (
                <TabsTrigger value="knowledge">
                  <span className="mr-1.5">🧠</span> Knowledge
                </TabsTrigger>
              )}
              <TabsTrigger value="config">
                <span className="mr-1.5">⚙️</span> Settings
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

          <TabsContent value="config" className="flex-1 overflow-auto m-0 p-6">
            <div className="max-w-4xl mx-auto">
              <Tabs defaultValue="profile" className="space-y-6">
                <TabsList>
                  {!!perms.llm_config && <TabsTrigger value="llm">🤖 LLM Providers</TabsTrigger>}
                  {!!perms.mcp_servers && <TabsTrigger value="mcp">🔌 MCP Servers</TabsTrigger>}
                  {!!perms.channels && <TabsTrigger value="channels">📡 Channels</TabsTrigger>}
                  <TabsTrigger value="profile">👤 Profile</TabsTrigger>
                  {userRole === "admin" && <TabsTrigger value="users">👥 Users</TabsTrigger>}
                </TabsList>

                <TabsContent value="llm" className="mt-4 space-y-4">
                  <div>
                    <h2 className="text-2xl font-display font-bold gradient-text">LLM Providers</h2>
                    <p className="text-sm text-muted-foreground mt-1 font-light">
                      Centralize Azure OpenAI, OpenAI, and Anthropic credentials.
                    </p>
                  </div>
                  <LlmConfig />
                </TabsContent>

                <TabsContent value="mcp" className="mt-4 space-y-4">
                  <div>
                    <h2 className="text-2xl font-display font-bold gradient-text">MCP Servers & Policies</h2>
                    <p className="text-sm text-muted-foreground mt-1 font-light">
                      Manage tool transports and approval / proactive toggles.
                    </p>
                  </div>
                  <McpConfig />
                </TabsContent>

                <TabsContent value="channels" className="mt-4 space-y-4">
                  <div>
                    <h2 className="text-2xl font-display font-bold gradient-text">Communication Channels</h2>
                    <p className="text-sm text-muted-foreground mt-1 font-light">
                      Connect messaging platforms so Nexus can chat with you anywhere.
                    </p>
                  </div>
                  <ChannelsConfig />
                </TabsContent>

                <TabsContent value="profile" className="mt-4 space-y-4">
                  <div>
                    <h2 className="text-2xl font-display font-bold gradient-text">Owner Profile</h2>
                    <p className="text-sm text-muted-foreground mt-1 font-light">
                      Your identity, skills, and contact info. Nexus uses this to personalize responses.
                    </p>
                  </div>
                  <ProfileConfig />
                </TabsContent>

                {userRole === "admin" && (
                  <TabsContent value="users" className="mt-4 space-y-4">
                    <div>
                      <h2 className="text-2xl font-display font-bold gradient-text">User Management</h2>
                      <p className="text-sm text-muted-foreground mt-1 font-light">
                        Manage user access, roles, and feature permissions.
                      </p>
                    </div>
                    <UserManagement />
                  </TabsContent>
                )}
              </Tabs>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
