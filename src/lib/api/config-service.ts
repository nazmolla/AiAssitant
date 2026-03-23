import { apiClient } from "./client";

export const configService = {
  // LLM
  getLlm: () => apiClient.get<unknown>("/api/config/llm"),
  saveLlm: (providers: unknown) => apiClient.put("/api/config/llm", { providers }),
  testLlm: (provider: unknown) => apiClient.post("/api/config/llm", { action: "test", provider }),
  getLlmRouting: () => apiClient.get<unknown>("/api/config/llm?routing=true"),
  saveLlmRouting: (routing: unknown) => apiClient.put("/api/config/llm", { routing }),

  // Logging
  getLogging: () => apiClient.get<{ min_level: string }>("/api/config/logging"),
  saveLogging: (min_level: string) => apiClient.put("/api/config/logging", { min_level }),
  cleanLogs: (body: unknown) => apiClient.post("/api/config/logging", body),

  // Search providers
  getSearchProviders: () => apiClient.get<unknown>("/api/config/search-providers"),
  saveSearchProviders: (providers: unknown) => apiClient.put("/api/config/search-providers", { providers }),

  // Profile
  getProfile: () => apiClient.get<unknown>("/api/config/profile"),
  saveProfile: (profile: unknown) => apiClient.put("/api/config/profile", profile),
  changePassword: (body: unknown) => apiClient.post("/api/config/profile", body),
  uploadAvatar: async (file: File) => {
    const form = new FormData();
    form.append("avatar", file);
    const res = await fetch("/api/config/profile", { method: "PATCH", body: form });
    if (!res.ok) throw new Error("Avatar upload failed");
    return res.json();
  },

  // Channels
  getChannels: () => apiClient.get<unknown>("/api/config/channels"),
  saveChannel: (channel: unknown) => apiClient.post("/api/config/channels", channel),
  updateChannel: (channel: unknown) => apiClient.put("/api/config/channels", channel),
  deleteChannel: (id: string) => apiClient.delete(`/api/config/channels?id=${encodeURIComponent(id)}`),

  // Auth Providers
  getAuthProviders: () => apiClient.get<unknown>("/api/config/auth"),
  saveAuthProvider: (provider: unknown) => apiClient.post("/api/config/auth", provider),
  updateAuthProvider: (provider: unknown) => apiClient.put("/api/config/auth", provider),
  deleteAuthProvider: (id: string) => apiClient.delete(`/api/config/auth?id=${encodeURIComponent(id)}`),

  // Whisper / STT
  getWhisper: () => apiClient.get<unknown>("/api/config/whisper"),
  saveWhisper: (config: unknown) => apiClient.put("/api/config/whisper", config),

  // Custom Tools
  getCustomTools: () => apiClient.get<unknown>("/api/config/custom-tools"),
  toggleCustomTool: (name: string, enabled: boolean) =>
    apiClient.put("/api/config/custom-tools", { name, enabled }),
  deleteCustomTool: (name: string) =>
    apiClient.delete(`/api/config/custom-tools?name=${encodeURIComponent(name)}`),

  // Tool Policies
  getToolPolicies: () => apiClient.get<unknown>("/api/policies"),
  saveToolPolicy: (policy: unknown) => apiClient.put("/api/policies", policy),

  // API Keys
  getApiKeys: () => apiClient.get<unknown>("/api/config/api-keys"),
  createApiKey: (body: unknown) => apiClient.post("/api/config/api-keys", body),
  deleteApiKey: (id: string) => apiClient.delete(`/api/config/api-keys?id=${encodeURIComponent(id)}`),

  // MCP Servers
  getMcpServers: () => apiClient.get<unknown>("/api/mcp"),
  saveMcpServer: (server: unknown) => apiClient.post("/api/mcp", server),
  updateMcpServer: (server: unknown) => apiClient.put("/api/mcp", server),
  deleteMcpServer: (id: string) => apiClient.delete(`/api/mcp?id=${encodeURIComponent(id)}`),
  testMcpServer: (server: unknown) => apiClient.post("/api/mcp", { ...server as Record<string, unknown>, action: "test" }),

  // Standing Orders
  getStandingOrders: () => apiClient.get<unknown>("/api/config/standing-orders"),
  saveStandingOrder: (order: unknown) => apiClient.post("/api/config/standing-orders", order),
  updateStandingOrder: (order: unknown) => apiClient.put("/api/config/standing-orders", order),
  deleteStandingOrder: (id: string) =>
    apiClient.delete(`/api/config/standing-orders?id=${encodeURIComponent(id)}`),
};
