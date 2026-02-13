"use client";

import { useEffect, useState } from "react";
import { useSession, signIn } from "next-auth/react";
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

export default function HomePage() {
  const { data: session, status } = useSession();
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/config/profile")
      .then((r) => r.json())
      .then((p) => { if (p?.display_name) setDisplayName(p.display_name); })
      .catch(() => {});
  }, []);

  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-lg text-muted-foreground">Loading Nexus...</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center space-y-6">
          <h1 className="text-4xl font-bold tracking-tight">Nexus Agent</h1>
          <p className="text-muted-foreground text-lg">
            Sovereign Proactive Personal AI
          </p>
          <Button size="lg" onClick={() => signIn()}>
            Sign In to Access
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="border-b px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">Nexus</h1>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-md">
            Command Center
          </span>
        </div>
        <div className="text-sm text-muted-foreground">
          {displayName || session.user?.email}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 overflow-hidden">
        <Tabs defaultValue="chat" className="flex flex-col h-full">
          <div className="border-b px-6">
            <TabsList className="h-12">
              <TabsTrigger value="chat">Chat</TabsTrigger>
              <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
              <TabsTrigger value="approvals">Approvals</TabsTrigger>
              <TabsTrigger value="knowledge">Knowledge Vault</TabsTrigger>
              <TabsTrigger value="config">Configurations</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="chat" className="flex-1 overflow-hidden m-0">
            <ChatPanel />
          </TabsContent>

          <TabsContent value="dashboard" className="flex-1 overflow-auto m-0 p-6">
            <AgentDashboard />
          </TabsContent>

          <TabsContent value="approvals" className="flex-1 overflow-auto m-0 p-6">
            <ApprovalInbox />
          </TabsContent>

          <TabsContent value="knowledge" className="flex-1 overflow-auto m-0 p-6">
            <KnowledgeVault />
          </TabsContent>

          <TabsContent value="config" className="flex-1 overflow-auto m-0 p-6">
            <Tabs defaultValue="llm" className="space-y-6">
              <TabsList>
                <TabsTrigger value="llm">LLM Providers</TabsTrigger>
                <TabsTrigger value="mcp">MCP Servers</TabsTrigger>
                <TabsTrigger value="channels">Channels</TabsTrigger>
                <TabsTrigger value="profile">Profile</TabsTrigger>
              </TabsList>

              <TabsContent value="llm" className="mt-4 space-y-4">
                <div>
                  <h2 className="text-2xl font-bold">LLM Providers</h2>
                  <p className="text-sm text-muted-foreground">
                    Centralize Azure OpenAI, OpenAI, and Anthropic credentials.
                  </p>
                </div>
                <LlmConfig />
              </TabsContent>

              <TabsContent value="mcp" className="mt-4 space-y-4">
                <div>
                  <h2 className="text-2xl font-bold">MCP Servers & Policies</h2>
                  <p className="text-sm text-muted-foreground">
                    Manage tool transports and approval / proactive toggles.
                  </p>
                </div>
                <McpConfig />
              </TabsContent>

              <TabsContent value="channels" className="mt-4 space-y-4">
                <div>
                  <h2 className="text-2xl font-bold">Communication Channels</h2>
                  <p className="text-sm text-muted-foreground">
                    Connect messaging platforms so Nexus can chat with you over WhatsApp, Slack, Email, and more.
                  </p>
                </div>
                <ChannelsConfig />
              </TabsContent>

              <TabsContent value="profile" className="mt-4 space-y-4">
                <div>
                  <h2 className="text-2xl font-bold">Owner Profile</h2>
                  <p className="text-sm text-muted-foreground">
                    Your display name, bio, skills, and contact information. Nexus uses this to personalize responses.
                  </p>
                </div>
                <ProfileConfig />
              </TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
