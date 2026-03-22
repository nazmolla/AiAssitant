"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

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
  scope: string;
  connected: boolean;
}

interface AdminUser {
  id: string;
  email: string;
  display_name: string | null;
}

export function McpConfig() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const { toastSnackbar, showToast } = useToast();

  // Add server form
  const [newName, setNewName] = useState("");
  const [newConnectionType, setNewConnectionType] = useState<"local" | "remote">("remote");
  const [newCommand, setNewCommand] = useState("");
  const [newArgs, setNewArgs] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newAuthType, setNewAuthType] = useState("none");
  const [newAccessToken, setNewAccessToken] = useState("");
  const [newClientId, setNewClientId] = useState("");
  const [newClientSecret, setNewClientSecret] = useState("");
  const [newScope, setNewScope] = useState<"global" | "restricted">("global");
  const [newAssignedUsers, setNewAssignedUsers] = useState<string[]>([]);

  // Status UI
  const [addingStatus, setAddingStatus] = useState<"idle" | "saving" | "connecting" | "done" | "error">("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);

  const fetchAll = useCallback(() => {
    fetch("/api/mcp").then((r) => r.json()).then((d) => { if (Array.isArray(d)) setServers(d); }).catch(console.error);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setAdminUsers(d as AdminUser[]); })
      .catch(() => { /* non-admin users won't have access */ });
  }, []);

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

  function resetMcpForm() {
    setNewName(""); setNewCommand(""); setNewArgs("");
    setNewUrl(""); setNewAuthType("none"); setNewAccessToken("");
    setNewClientId(""); setNewClientSecret("");
    setNewScope("global"); setNewAssignedUsers([]);
    setEditingServerId(null);
    setNewConnectionType("remote");
  }

  function startEditServer(server: McpServer) {
    setEditingServerId(server.id);
    setNewName(server.name);

    const isLocal = server.transport_type === "stdio";
    setNewConnectionType(isLocal ? "local" : "remote");
    setNewCommand(server.command || "");

    // Parse args back from JSON string
    if (server.args) {
      try {
        const parsed = JSON.parse(server.args);
        setNewArgs(Array.isArray(parsed) ? parsed.join(" ") : "");
      } catch {
        setNewArgs("");
      }
    } else {
      setNewArgs("");
    }

    setNewUrl(server.url || "");
    setNewAuthType(server.auth_type || "none");
    // Show masked placeholders for secrets
    setNewAccessToken(server.access_token || "");
    setNewClientId(server.client_id || "");
    setNewClientSecret(server.client_secret || "");

    const scope = (server.scope === "restricted" ? "restricted" : "global") as "global" | "restricted";
    setNewScope(scope);
    setNewAssignedUsers([]);

    // Load currently assigned users for restricted servers
    if (scope === "restricted") {
      fetch(`/api/config/mcp/${server.id}/users`)
        .then((r) => r.json())
        .then((d) => { if (Array.isArray(d.userIds)) setNewAssignedUsers(d.userIds as string[]); })
        .catch(() => {});
    }

    setAddingStatus("idle");
    setStatusMessage("");

    // Scroll form into view
    document.getElementById("mcp-server-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function addServer() {
    const isLocal = newConnectionType === "local";
    const serverId = editingServerId || (typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const bytes = crypto.getRandomValues(new Uint8Array(1));
          const r = bytes[0] & 0xf;
          return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
        }));
    if (!newName) return;
    if (isLocal && !newCommand) return;
    if (!isLocal && !newUrl) return;

    setAddingStatus("saving");
    setStatusMessage(editingServerId ? "Updating server configuration..." : "Saving server configuration...");

    try {
      // Build the payload — for edits, keep existing secrets if user left fields blank
      const payload: Record<string, unknown> = {
        id: serverId,
        name: newName,
        transport_type: isLocal ? "stdio" : "streamablehttp",
        command: isLocal ? newCommand : undefined,
        args: isLocal && newArgs ? newArgs.split(" ") : [],
        url: !isLocal ? newUrl : undefined,
        auth_type: !isLocal ? newAuthType : "none",
        scope: newScope,
      };

      // Only send secrets if user provided new values (not masked placeholders)
      if (newAccessToken && newAccessToken !== "••••••") payload.access_token = newAccessToken;
      else if (!editingServerId) payload.access_token = newAccessToken || undefined;

      if (newClientId) payload.client_id = newClientId;
      else if (!editingServerId) payload.client_id = newClientId || undefined;

      if (newClientSecret && newClientSecret !== "••••••") payload.client_secret = newClientSecret;
      else if (!editingServerId) payload.client_secret = newClientSecret || undefined;

      const res = await fetch("/api/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to save server");
      }

      // Save assigned users for restricted servers
      if (newScope === "restricted") {
        await fetch(`/api/config/mcp/${serverId}/users`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userIds: newAssignedUsers }),
        }).catch(() => {});
      }

      // For OAuth without existing token: redirect to OAuth flow
      if (!isLocal && newAuthType === "oauth" && !newAccessToken) {
        // Reset form only for OAuth redirect (user will return via callback)
        resetMcpForm();
        setAddingStatus("connecting");
        setStatusMessage("Redirecting to OAuth login...");
        window.location.href = `/api/mcp/${serverId}/oauth/authorize`;
        return;
      }

      // For edits: disconnect first so we can reconnect with new config
      if (editingServerId) {
        const mcpManager = servers.find((s) => s.id === editingServerId);
        if (mcpManager?.connected) {
          await fetch(`/api/mcp/${editingServerId}/connect`, { method: "DELETE" }).catch(() => {});
        }
      }

      // Auto-connect — if this fails for new servers, we roll back (delete the saved server)
      setAddingStatus("connecting");
      setStatusMessage("Connecting to server and discovering tools...");

      const connectRes = await fetch(`/api/mcp/${serverId}/connect`, { method: "POST" });
      let connectData: { error?: string; tools?: unknown[] };
      try {
        connectData = await connectRes.json();
      } catch {
        connectData = { error: `Server returned non-JSON response (HTTP ${connectRes.status}).` };
      }

      if (!connectRes.ok) {
        if (!editingServerId) {
          // Connection failed on new server — remove the server we just saved so it doesn't linger
          await fetch(`/api/mcp?id=${serverId}`, { method: "DELETE" }).catch(() => {});
        }
        setAddingStatus("error");
        setStatusMessage(connectData.error || `Connection failed.${editingServerId ? " Server config was saved but could not reconnect." : " Server was not added."}`);
        fetchAll();
        // Do NOT reset form fields so the user can fix and retry
        return;
      }

      // Success — now clear the form
      resetMcpForm();

      setAddingStatus("done");
      setStatusMessage(editingServerId
        ? `Updated and reconnected! Discovered ${connectData.tools?.length || 0} tools.`
        : `Connected! Discovered ${connectData.tools?.length || 0} tools.`);
      fetchAll();
      setTimeout(() => { setAddingStatus("idle"); setStatusMessage(""); }, 4000);
    } catch (err) {
      setAddingStatus("error");
      setStatusMessage(err instanceof Error ? err.message : "An error occurred");
      fetchAll();
      // Do NOT reset form fields on error
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
    try {
      const res = await fetch(`/api/mcp?id=${serverId}`, { method: "DELETE" });
      if (!res.ok) {
        let errorMsg = `Failed to remove server (HTTP ${res.status})`;
        try {
          const data = await res.json();
          if (data.error) errorMsg = data.error;
        } catch {}
        showToast(errorMsg);
        return;
      }
    } catch (err) {
      console.error("Delete failed:", err);
      showToast(`Delete failed: ${err instanceof Error ? err.message : String(err)}`);
    }
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

      {/* Add/Edit Server Form */}
      <Card id="mcp-server-form">
        <CardHeader>
          <CardTitle className="text-base font-display">{editingServerId ? "Edit MCP Server" : "Add MCP Server"}</CardTitle>
          <CardDescription className="text-muted-foreground/60">
            {editingServerId
              ? "Update the server configuration below. Leave password fields blank to keep existing values."
              : "Configure a new Model Context Protocol server connection."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3">
            <Input placeholder="Display Name (e.g., Home Assistant)" value={newName} onChange={(e) => setNewName(e.target.value)} />

            {/* Connection type toggle */}
            <div className="col-span-2 flex flex-wrap gap-2">
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
                  <div className="flex flex-wrap gap-2">
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

          {/* Scope section — admin only (adminUsers list will be empty for non-admins) */}
          {adminUsers.length > 0 && (
            <div className="mt-3 space-y-2">
              <label className="text-[11px] text-muted-foreground/60 block uppercase tracking-wider font-medium">Access Scope</label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={newScope === "global" ? "default" : "outline"}
                  onClick={() => setNewScope("global")}
                >
                  Global
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={newScope === "restricted" ? "default" : "outline"}
                  onClick={() => setNewScope("restricted")}
                >
                  Restricted
                </Button>
              </div>

              {newScope === "restricted" && (
                <div className="space-y-1">
                  <label className="text-[11px] text-muted-foreground/60 block uppercase tracking-wider font-medium">Assign Users</label>
                  <div className="flex flex-col gap-1 max-h-40 overflow-y-auto rounded-lg border border-white/[0.06] p-2">
                    {adminUsers.map((u) => (
                      <label key={u.id} className="flex items-center gap-2 cursor-pointer text-sm py-0.5">
                        <input
                          type="checkbox"
                          className="rounded"
                          checked={newAssignedUsers.includes(u.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNewAssignedUsers((prev) => [...prev, u.id]);
                            } else {
                              setNewAssignedUsers((prev) => prev.filter((id) => id !== u.id));
                            }
                          }}
                        />
                        <span>{u.display_name || u.email}</span>
                        <span className="text-muted-foreground/40 text-[11px]">{u.email}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-3 flex gap-3">
            {editingServerId && (
              <Button type="button" variant="ghost" onClick={resetMcpForm}>
                Cancel Edit
              </Button>
            )}
            <Button
              onClick={addServer}
              disabled={
                addingStatus === "saving" || addingStatus === "connecting" ||
                !newName ||
                (newConnectionType === "local" ? !newCommand : !newUrl)
              }
            >
              {addingStatus === "saving" || addingStatus === "connecting"
                ? (editingServerId ? "Updating..." : "Adding...")
                : editingServerId ? "Update & Reconnect" : "Add & Connect"}
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
              <div key={server.id} className="rounded-xl border border-white/[0.06] p-4 hover:bg-white/[0.02] transition-all duration-300">
                <div className="md:hidden space-y-3">
                  <div className="min-w-0">
                    <div className="font-medium text-sm break-words">{server.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant={server.connected ? "success" : "secondary"} className="text-xs">
                        {server.connected ? "Connected" : "Disconnected"}
                      </Badge>
                      {server.scope === "restricted" && (
                        <Badge variant="secondary" className="text-xs">Restricted</Badge>
                      )}
                      {server.transport_type && (
                        <span className="text-[11px] text-muted-foreground/50">
                          {server.transport_type}
                          {server.auth_type && server.auth_type !== "none" ? ` · ${server.auth_type}` : ""}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground/40 mt-1 break-all">
                      {server.transport_type === "stdio"
                        ? `${server.command || ""} ${server.args ? JSON.parse(server.args).join(" ") : ""}`
                        : server.url || server.command || ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {server.connected ? (
                      <Button size="sm" variant="outline" className="flex-1" onClick={() => disconnectServer(server.id)}>
                        Disconnect
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => connectServer(server.id)}
                        disabled={connectingId === server.id}
                      >
                        {connectingId === server.id ? "Connecting..." : "Connect"}
                      </Button>
                    )}
                    <Button size="sm" variant="outline" className="flex-1" onClick={() => startEditServer(server)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="destructive" className="flex-1" onClick={() => deleteServer(server.id)}>
                      Remove
                    </Button>
                  </div>
                </div>

                <div className="hidden md:flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{server.name}</span>
                      <Badge variant={server.connected ? "success" : "secondary"} className="text-xs">
                        {server.connected ? "Connected" : "Disconnected"}
                      </Badge>
                      {server.scope === "restricted" && (
                        <Badge variant="secondary" className="text-xs">Restricted</Badge>
                      )}
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
                    <Button size="sm" variant="outline" onClick={() => startEditServer(server)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => deleteServer(server.id)}>
                      Remove
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
      {toastSnackbar}
    </div>
  );
}
