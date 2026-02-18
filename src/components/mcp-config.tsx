"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

interface McpServer {
  id: string;
  name: string;
  transport_type: string | null;
  command: string | null;
  args: string | null;
  env_vars: string | null;
  url: string | null;
  auth_type: string | null;
  access_token: string | null;
  client_id: string | null;
  client_secret: string | null;
  connected: boolean;
}

interface ToolPolicy {
  tool_name: string;
  mcp_id: string | null;
  requires_approval: number;
  is_proactive_enabled: number;
}

interface ToolDef {
  name: string;
  description: string;
}

export function McpConfig() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [tools, setTools] = useState<ToolDef[]>([]);
  const [policies, setPolicies] = useState<ToolPolicy[]>([]);

  // Add server form
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [newConnectionType, setNewConnectionType] = useState<"local" | "remote">("remote");
  const [newCommand, setNewCommand] = useState("");
  const [newArgs, setNewArgs] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newAuthType, setNewAuthType] = useState("none");
  const [newAccessToken, setNewAccessToken] = useState("");
  const [newClientId, setNewClientId] = useState("");
  const [newClientSecret, setNewClientSecret] = useState("");

  // Status UI
  const [addingStatus, setAddingStatus] = useState<"idle" | "saving" | "connecting" | "done" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [connectingId, setConnectingId] = useState<string | null>(null);

  const fetchAll = useCallback(() => {
    fetch("/api/mcp").then((r) => r.json()).then(setServers).catch(console.error);
    fetch("/api/mcp/tools").then((r) => r.json()).then(setTools).catch(console.error);
    fetch("/api/policies").then((r) => r.json()).then(setPolicies).catch(console.error);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Check for OAuth callback token in URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthServerId = params.get("oauth_server_id");
    const oauthToken = params.get("oauth_token");
    const oauthError = params.get("oauth_error");

    if (oauthError) {
      setAddingStatus("error");
      setStatusMessage(`OAuth failed: ${oauthError}`);
      // Clean URL
      window.history.replaceState({}, "", window.location.pathname);
    } else if (oauthServerId && oauthToken) {
      // OAuth succeeded - token is already saved by the callback route
      // Just connect the server now
      setAddingStatus("connecting");
      setStatusMessage("OAuth successful! Connecting to server...");
      window.history.replaceState({}, "", window.location.pathname);

      fetch(`/api/mcp/${oauthServerId}/connect`, { method: "POST" })
        .then(async (r) => {
          const data = await r.json();
          if (!r.ok) throw new Error(data.error || "Connection failed");
          setAddingStatus("done");
          setStatusMessage(`Connected! Discovered ${data.tools?.length || 0} tools.`);
          fetchAll();
          setTimeout(() => { setAddingStatus("idle"); setStatusMessage(""); }, 4000);
        })
        .catch((err) => {
          setAddingStatus("error");
          setStatusMessage(err.message);
          fetchAll();
        });
    }
  }, [fetchAll]);

  async function addServer() {
    const isLocal = newConnectionType === "local";
    if (!newId || !newName) return;
    if (isLocal && !newCommand) return;
    if (!isLocal && !newUrl) return;

    setAddingStatus("saving");
    setStatusMessage("Saving server configuration...");

    try {
      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: newId,
          name: newName,
          transport_type: isLocal ? "stdio" : "streamablehttp",
          command: isLocal ? newCommand : undefined,
          args: isLocal && newArgs ? newArgs.split(" ") : [],
          url: !isLocal ? newUrl : undefined,
          auth_type: !isLocal ? newAuthType : "none",
          access_token: newAccessToken || undefined,
          client_id: newClientId || undefined,
          client_secret: newClientSecret || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save server");
      }

      const savedId = newId;

      // Reset form
      setNewId(""); setNewName(""); setNewCommand(""); setNewArgs("");
      setNewUrl(""); setNewAuthType("none"); setNewAccessToken("");
      setNewClientId(""); setNewClientSecret("");

      // For OAuth without existing token: redirect to OAuth flow
      if (!isLocal && newAuthType === "oauth" && !newAccessToken) {
        setAddingStatus("connecting");
        setStatusMessage("Redirecting to OAuth login...");
        // Redirect to our OAuth initiation endpoint
        window.location.href = `/api/mcp/${savedId}/oauth/authorize`;
        return;
      }

      // Auto-connect
      setAddingStatus("connecting");
      setStatusMessage("Connecting to server and discovering tools...");

      const connectRes = await fetch(`/api/mcp/${savedId}/connect`, { method: "POST" });
      const connectData = await connectRes.json();

      if (!connectRes.ok) {
        throw new Error(connectData.error || "Connection failed");
      }

      setAddingStatus("done");
      setStatusMessage(`Connected! Discovered ${connectData.tools?.length || 0} tools.`);
      fetchAll();
      setTimeout(() => { setAddingStatus("idle"); setStatusMessage(""); }, 4000);
    } catch (err) {
      setAddingStatus("error");
      setStatusMessage(err instanceof Error ? err.message : "An error occurred");
      fetchAll();
    }
  }

  async function connectServer(serverId: string) {
    setConnectingId(serverId);
    try {
      const res = await fetch(`/api/mcp/${serverId}/connect`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Connection failed");
      fetchAll();
    } catch {
      // Error is visible via server status
    }
    setConnectingId(null);
  }

  async function disconnectServer(serverId: string) {
    await fetch(`/api/mcp/${serverId}/connect`, { method: "DELETE" });
    fetchAll();
  }

  async function deleteServer(serverId: string) {
    await fetch(`/api/mcp?id=${serverId}`, { method: "DELETE" });
    fetchAll();
  }

  async function togglePolicy(toolName: string, field: "requires_approval" | "is_proactive_enabled", value: boolean) {
    const existing = policies.find((p) => p.tool_name === toolName);
    await fetch("/api/policies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool_name: toolName,
        mcp_id: existing?.mcp_id || null,
        requires_approval: field === "requires_approval" ? value : existing?.requires_approval ?? true,
        is_proactive_enabled: field === "is_proactive_enabled" ? value : existing?.is_proactive_enabled ?? false,
      }),
    });
    fetchAll();
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-display font-semibold sr-only">MCP Configuration</h2>

      {/* Status Banner */}
      {addingStatus !== "idle" && (
        <div className={`rounded-xl px-4 py-3 text-sm font-medium backdrop-blur-sm transition-all duration-300 ${
          addingStatus === "error"
            ? "bg-red-500/5 text-red-400 border border-red-500/15"
            : addingStatus === "done"
            ? "bg-green-500/5 text-green-400 border border-green-500/15"
            : "bg-blue-500/5 text-blue-400 border border-blue-500/15"
        }`}>
          {(addingStatus === "saving" || addingStatus === "connecting") && (
            <span className="inline-block mr-2 animate-spin">⏳</span>
          )}
          {addingStatus === "done" && <span className="mr-2">✅</span>}
          {addingStatus === "error" && <span className="mr-2">❌</span>}
          {statusMessage}
          {addingStatus === "error" && (
            <Button size="sm" variant="ghost" className="ml-3 h-6 text-xs" onClick={() => { setAddingStatus("idle"); setStatusMessage(""); }}>
              Dismiss
            </Button>
          )}
        </div>
      )}

      {/* Add Server Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-display">Add MCP Server</CardTitle>
          <CardDescription className="text-muted-foreground/60">Configure a new Model Context Protocol server connection.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="Server ID (e.g., homeassistant)" value={newId} onChange={(e) => setNewId(e.target.value)} />
            <Input placeholder="Display Name (e.g., Home Assistant)" value={newName} onChange={(e) => setNewName(e.target.value)} />

            {/* Connection type toggle */}
            <div className="col-span-2 flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={newConnectionType === "remote" ? "default" : "outline"}
                onClick={() => setNewConnectionType("remote")}
              >
                🌐 Remote Server (URL)
              </Button>
              <Button
                type="button"
                size="sm"
                variant={newConnectionType === "local" ? "default" : "outline"}
                onClick={() => setNewConnectionType("local")}
              >
                💻 Local Command
              </Button>
            </div>

            {newConnectionType === "local" ? (
              <>
                <Input placeholder="Command (e.g., npx)" value={newCommand} onChange={(e) => setNewCommand(e.target.value)} />
                <Input placeholder="Arguments (e.g., -y @modelcontextprotocol/server-github)" value={newArgs} onChange={(e) => setNewArgs(e.target.value)} />
              </>
            ) : (
              <>
                <Input
                  placeholder="Server URL (e.g., https://homeassistant.local:8123/api/mcp)"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  className="col-span-2"
                />

                {/* Auth type */}
                <div className="col-span-2">
                  <label className="text-[11px] text-muted-foreground/60 mb-1.5 block uppercase tracking-wider font-medium">Authentication</label>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant={newAuthType === "none" ? "default" : "outline"} onClick={() => setNewAuthType("none")}>
                      None
                    </Button>
                    <Button type="button" size="sm" variant={newAuthType === "bearer" ? "default" : "outline"} onClick={() => setNewAuthType("bearer")}>
                      🔑 Access Token
                    </Button>
                    <Button type="button" size="sm" variant={newAuthType === "oauth" ? "default" : "outline"} onClick={() => setNewAuthType("oauth")}>
                      🔐 OAuth
                    </Button>
                  </div>
                </div>

                {newAuthType === "bearer" && (
                  <Input
                    type="password"
                    placeholder="Paste your long-lived access token here"
                    value={newAccessToken}
                    onChange={(e) => setNewAccessToken(e.target.value)}
                    className="col-span-2"
                  />
                )}

                {newAuthType === "oauth" && (
                  <>
                    <Input
                      placeholder="Client ID (e.g., https://your-domain.com)"
                      value={newClientId}
                      onChange={(e) => setNewClientId(e.target.value)}
                    />
                    <Input
                      type="password"
                      placeholder="Client Secret (leave empty if not required)"
                      value={newClientSecret}
                      onChange={(e) => setNewClientSecret(e.target.value)}
                    />
                    <Input
                      type="password"
                      placeholder="Access Token (if you already have one)"
                      value={newAccessToken}
                      onChange={(e) => setNewAccessToken(e.target.value)}
                      className="col-span-2"
                    />
                  </>
                )}
              </>
            )}
          </div>
          <div className="mt-3">
            <Button
              onClick={addServer}
              disabled={
                addingStatus === "saving" || addingStatus === "connecting" ||
                !newId || !newName ||
                (newConnectionType === "local" ? !newCommand : !newUrl)
              }
            >
              {addingStatus === "saving" || addingStatus === "connecting" ? "Adding..." : "Add & Connect"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Server List */}
      {servers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-display">Configured Servers</CardTitle>
            <CardDescription className="text-muted-foreground/50">{servers.length} server{servers.length !== 1 ? "s" : ""} configured</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {servers.map((server) => (
              <div key={server.id} className="flex items-center justify-between rounded-xl border border-white/[0.06] p-4 hover:bg-white/[0.02] transition-all duration-300">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{server.name}</span>
                    <Badge variant={server.connected ? "success" : "secondary"} className="text-xs">
                      {server.connected ? "Connected" : "Disconnected"}
                    </Badge>
                    {server.transport_type && (
                      <span className="text-[11px] text-muted-foreground/50">
                        {server.transport_type}
                        {server.auth_type && server.auth_type !== "none" ? ` · ${server.auth_type}` : ""}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground/40 mt-1 truncate">
                    {server.transport_type === "stdio"
                      ? `${server.command || ""} ${server.args ? JSON.parse(server.args).join(" ") : ""}`
                      : server.url || server.command || ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-3 shrink-0">
                  {server.connected ? (
                    <Button size="sm" variant="outline" onClick={() => disconnectServer(server.id)}>
                      Disconnect
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => connectServer(server.id)}
                      disabled={connectingId === server.id}
                    >
                      {connectingId === server.id ? "Connecting..." : "Connect"}
                    </Button>
                  )}
                  <Button size="sm" variant="destructive" onClick={() => deleteServer(server.id)}>
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Tool Policies */}
      {tools.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-display">Tool Policies</CardTitle>
            <CardDescription className="text-muted-foreground/60">
              Configure approval requirements and proactive scanning for each discovered tool.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.06] text-left text-[11px] text-muted-foreground/50 uppercase tracking-wider">
                  <th className="p-4 font-medium">Tool</th>
                  <th className="p-4 font-medium">Description</th>
                  <th className="p-4 text-center font-medium">Requires Approval</th>
                  <th className="p-4 text-center font-medium">Proactive Enabled</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((tool) => {
                  const policy = policies.find((p) => p.tool_name === tool.name);
                  return (
                    <tr key={tool.name} className="border-b border-white/[0.04] hover:bg-white/[0.02] transition-colors duration-200">
                      <td className="p-4 text-sm font-mono text-primary/80">{tool.name}</td>
                      <td className="p-4 text-sm text-muted-foreground/60">
                        {tool.description.substring(0, 80)}
                        {tool.description.length > 80 ? "..." : ""}
                      </td>
                      <td className="p-4 text-center">
                        <Switch
                          checked={policy?.requires_approval !== 0}
                          onCheckedChange={(v) => togglePolicy(tool.name, "requires_approval", v)}
                        />
                      </td>
                      <td className="p-4 text-center">
                        <Switch
                          checked={policy?.is_proactive_enabled === 1}
                          onCheckedChange={(v) => togglePolicy(tool.name, "is_proactive_enabled", v)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
