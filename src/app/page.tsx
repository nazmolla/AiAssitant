"use client";

import { useSession, signIn } from "next-auth/react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ChatPanel } from "@/components/chat-panel";
import { ApprovalInbox } from "@/components/approval-inbox";
import { KnowledgeVault } from "@/components/knowledge-vault";
import { McpConfig } from "@/components/mcp-config";
import { AgentDashboard } from "@/components/agent-dashboard";

export default function HomePage() {
  const { data: session, status } = useSession();

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
          {session.user?.email}
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
              <TabsTrigger value="mcp">MCP Config</TabsTrigger>
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

          <TabsContent value="mcp" className="flex-1 overflow-auto m-0 p-6">
            <McpConfig />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
