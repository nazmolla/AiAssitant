import SwiftUI

/// Main settings hub with navigation to sub-sections.
struct SettingsView: View {
    @EnvironmentObject var authVM: AuthViewModel

    var body: some View {
        NavigationStack {
            List {
                Section("AI Configuration") {
                    NavigationLink {
                        LLMConfigView()
                    } label: {
                        Label("LLM Providers", systemImage: "cpu")
                    }

                    NavigationLink {
                        PoliciesView()
                    } label: {
                        Label("Tool Policies", systemImage: "shield.checkered")
                    }

                    NavigationLink {
                        MCPServersView()
                    } label: {
                        Label("MCP Servers", systemImage: "server.rack")
                    }

                    NavigationLink {
                        CustomToolsView()
                    } label: {
                        Label("Custom Tools", systemImage: "wrench.and.screwdriver")
                    }
                }

                Section("Integrations") {
                    NavigationLink {
                        ChannelsView()
                    } label: {
                        Label("Channels", systemImage: "antenna.radiowaves.left.and.right")
                    }

                    NavigationLink {
                        AlexaConfigView()
                    } label: {
                        Label("Alexa", systemImage: "homepod.fill")
                    }
                }

                Section("Authentication") {
                    NavigationLink {
                        APIKeysView()
                    } label: {
                        Label("API Keys", systemImage: "key.fill")
                    }
                }

                if authVM.currentUser?.role == "admin" {
                    Section("Administration") {
                        NavigationLink {
                            AdminUsersView()
                        } label: {
                            Label("Users", systemImage: "person.2.fill")
                        }

                        NavigationLink {
                            LogsView()
                        } label: {
                            Label("Agent Logs", systemImage: "doc.text.magnifyingglass")
                        }
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Settings")
        }
    }
}
