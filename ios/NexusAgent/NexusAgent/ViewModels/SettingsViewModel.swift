import Foundation

/// Manages all settings: LLM providers, API keys, policies, MCP servers, channels, custom tools, Alexa.
@MainActor
final class SettingsViewModel: ObservableObject {
    // LLM Providers
    @Published var providers: [LLMProvider] = []
    @Published var isLoadingProviders = false

    // API Keys
    @Published var apiKeys: [ApiKeyRecord] = []
    @Published var newlyCreatedKey: String?

    // Policies
    @Published var policies: [ToolPolicy] = []

    // MCP Servers
    @Published var mcpServers: [MCPServer] = []

    // Channels
    @Published var channels: [Channel] = []

    // Custom Tools
    @Published var customTools: [CustomTool] = []

    // Alexa
    @Published var alexaConfig: AlexaConfig?

    // General
    @Published var isLoading = false
    @Published var error: String?

    private let api = APIClient.shared

    // MARK: - LLM Providers

    func loadProviders() async {
        isLoadingProviders = true
        defer { isLoadingProviders = false }
        do {
            providers = try await api.get("api/config/llm")
        } catch {
            self.error = error.localizedDescription
        }
    }

    func createProvider(_ req: LLMProviderCreateRequest) async -> Bool {
        do {
            let provider: LLMProvider = try await api.post("api/config/llm", body: req)
            providers.append(provider)
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func updateProvider(_ req: LLMProviderUpdateRequest) async -> Bool {
        do {
            let updated: LLMProvider = try await api.patch("api/config/llm", body: req)
            if let idx = providers.firstIndex(where: { $0.id == updated.id }) {
                providers[idx] = updated
            }
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func deleteProvider(_ id: String) async {
        do {
            struct Body: Codable { let id: String }
            try await api.delete("api/config/llm", body: Body(id: id))
            providers.removeAll { $0.id == id }
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - API Keys

    func loadApiKeys() async {
        do {
            apiKeys = try await api.get("api/config/api-keys")
        } catch {
            self.error = error.localizedDescription
        }
    }

    func createApiKey(name: String, scopes: [String]?, expiresAt: String?) async -> Bool {
        do {
            let body = ApiKeyCreateRequest(name: name, scopes: scopes, expiresAt: expiresAt)
            let key: ApiKeyRecord = try await api.post("api/config/api-keys", body: body)
            newlyCreatedKey = key.rawKey
            apiKeys.append(key)
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func deleteApiKey(_ id: String) async {
        do {
            try await api.delete("api/config/api-keys", body: ApiKeyDeleteRequest(id: id))
            apiKeys.removeAll { $0.id == id }
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Policies

    func loadPolicies() async {
        do {
            policies = try await api.get("api/config/policies")
        } catch {
            self.error = error.localizedDescription
        }
    }

    func savePolicy(_ policy: PolicyCreateRequest) async -> Bool {
        do {
            try await api.post("api/config/policies", body: policy) as Void
            await loadPolicies()
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    // MARK: - MCP Servers

    func loadMCPServers() async {
        do {
            mcpServers = try await api.get("api/config/mcp")
        } catch {
            self.error = error.localizedDescription
        }
    }

    func createMCPServer(_ req: MCPServerCreateRequest) async -> Bool {
        do {
            let server: MCPServer = try await api.post("api/config/mcp", body: req)
            mcpServers.append(server)
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func deleteMCPServer(_ id: String) async {
        do {
            try await api.delete("api/config/mcp", body: MCPServerDeleteRequest(id: id))
            mcpServers.removeAll { $0.id == id }
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Channels

    func loadChannels() async {
        do {
            channels = try await api.get("api/config/channels")
        } catch {
            self.error = error.localizedDescription
        }
    }

    func createChannel(_ req: ChannelCreateRequest) async -> Bool {
        do {
            let ch: Channel = try await api.post("api/config/channels", body: req)
            channels.append(ch)
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func updateChannel(_ req: ChannelUpdateRequest) async -> Bool {
        do {
            let updated: Channel = try await api.patch("api/config/channels", body: req)
            if let idx = channels.firstIndex(where: { $0.id == updated.id }) {
                channels[idx] = updated
            }
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func deleteChannel(_ id: String) async {
        do {
            struct Body: Codable { let id: String }
            try await api.delete("api/config/channels", body: Body(id: id))
            channels.removeAll { $0.id == id }
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Custom Tools

    func loadCustomTools() async {
        do {
            customTools = try await api.get("api/config/custom-tools")
        } catch {
            self.error = error.localizedDescription
        }
    }

    func createCustomTool(_ req: CustomToolCreateRequest) async -> Bool {
        do {
            let tool: CustomTool = try await api.post("api/config/custom-tools", body: req)
            customTools.append(tool)
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func toggleCustomTool(_ name: String, enabled: Bool) async {
        do {
            try await api.put("api/config/custom-tools", body: CustomToolToggleRequest(name: name, enabled: enabled)) as Void
            if let idx = customTools.firstIndex(where: { $0.name == name }) {
                customTools[idx].enabled = enabled ? 1 : 0
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    func deleteCustomTool(_ name: String) async {
        do {
            try await api.delete("api/config/custom-tools", body: CustomToolDeleteRequest(name: name))
            customTools.removeAll { $0.name == name }
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Alexa

    func loadAlexaConfig() async {
        do {
            alexaConfig = try await api.get("api/config/alexa")
        } catch {
            // Non-critical, might not be configured
        }
    }

    func updateAlexaConfig(ubidMain: String, atMain: String) async -> Bool {
        do {
            let body = AlexaUpdateRequest(ubidMain: ubidMain, atMain: atMain)
            try await api.put("api/config/alexa", body: body) as Void
            alexaConfig = AlexaConfig(configured: true, ubidMain: "****", atMain: "****")
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    // MARK: - Load All

    func loadAll() async {
        isLoading = true
        defer { isLoading = false }

        async let p: () = loadProviders()
        async let k: () = loadApiKeys()
        async let po: () = loadPolicies()
        async let m: () = loadMCPServers()
        async let ch: () = loadChannels()
        async let ct: () = loadCustomTools()
        async let a: () = loadAlexaConfig()

        _ = await (p, k, po, m, ch, ct, a)
    }
}
