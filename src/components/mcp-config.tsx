"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

interface McpServer {
  id: string;
  name: string;
  transport_type: string | null;
  command: string;
  args: string | null;
  env_vars: string | null;
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
  const [newCommand, setNewCommand] = useState("");
  const [newArgs, setNewArgs] = useState("");
  const [newTransport, setNewTransport] = useState("stdio");

  const fetchAll = () => {
    fetch("/api/mcp").then((r) => r.json()).then(setServers).catch(console.error);
    fetch("/api/mcp/tools").then((r) => r.json()).then(setTools).catch(console.error);
    fetch("/api/policies").then((r) => r.json()).then(setPolicies).catch(console.error);
  };

  useEffect(() => { fetchAll(); }, []);

  async function addServer() {
    if (!newId || !newName || !newCommand) return;

    await fetch("/api/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: newId,
        name: newName,
        transport_type: newTransport,
        command: newCommand,
        args: newArgs ? newArgs.split(" ") : [],
      }),
    });
    setNewId(""); setNewName(""); setNewCommand(""); setNewArgs("");
    fetchAll();
  }

  async function connectServer(serverId: string) {
    await fetch(`/api/mcp/${serverId}/connect`, { method: "POST" });
    fetchAll();
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
      <h2 className="text-2xl font-bold">MCP Configuration</h2>

      {/* Add Server Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add MCP Server</CardTitle>
          <CardDescription>Configure a new Model Context Protocol server connection.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="Server ID (e.g., github)" value={newId} onChange={(e) => setNewId(e.target.value)} />
            <Input placeholder="Display Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Input placeholder="Command (e.g., npx)" value={newCommand} onChange={(e) => setNewCommand(e.target.value)} />
            <Input placeholder="Args (space-separated)" value={newArgs} onChange={(e) => setNewArgs(e.target.value)} />
          </div>
          <div className="mt-3">
            <Button onClick={addServer} disabled={!newId || !newName || !newCommand}>
              Add Server
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Server List */}
      <div className="grid gap-4">
        {servers.map((server) => (
          <Card key={server.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">{server.name}</CardTitle>
                  <CardDescription>
                    {server.command} {server.args ? JSON.parse(server.args).join(" ") : ""}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={server.connected ? "success" : "secondary"}>
                    {server.connected ? "Connected" : "Disconnected"}
                  </Badge>
                  {server.connected ? (
                    <Button size="sm" variant="outline" onClick={() => disconnectServer(server.id)}>
                      Disconnect
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => connectServer(server.id)}>
                      Connect
                    </Button>
                  )}
                  <Button size="sm" variant="destructive" onClick={() => deleteServer(server.id)}>
                    Remove
                  </Button>
                </div>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>

      {/* Tool Policies */}
      {tools.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tool Policies</CardTitle>
            <CardDescription>
              Configure approval requirements and proactive scanning for each discovered tool.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-muted-foreground">
                  <th className="p-3">Tool</th>
                  <th className="p-3">Description</th>
                  <th className="p-3 text-center">Requires Approval</th>
                  <th className="p-3 text-center">Proactive Enabled</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((tool) => {
                  const policy = policies.find((p) => p.tool_name === tool.name);
                  return (
                    <tr key={tool.name} className="border-b">
                      <td className="p-3 text-sm font-mono">{tool.name}</td>
                      <td className="p-3 text-sm text-muted-foreground">
                        {tool.description.substring(0, 80)}
                        {tool.description.length > 80 ? "..." : ""}
                      </td>
                      <td className="p-3 text-center">
                        <Switch
                          checked={policy?.requires_approval !== 0}
                          onCheckedChange={(v) => togglePolicy(tool.name, "requires_approval", v)}
                        />
                      </td>
                      <td className="p-3 text-center">
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
