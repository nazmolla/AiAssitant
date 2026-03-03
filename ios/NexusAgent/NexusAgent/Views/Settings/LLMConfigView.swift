import SwiftUI

/// LLM Provider management — list, add, edit, delete.
struct LLMConfigView: View {
    @StateObject private var vm = SettingsViewModel()
    @State private var showAddSheet = false

    var body: some View {
        List {
            ForEach(vm.providers) { provider in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Image(systemName: providerIcon(provider.provider_type))
                            .foregroundStyle(.accentColor)
                        Text(provider.label)
                            .font(.headline)
                        Spacer()
                        if provider.is_default {
                            Text("DEFAULT")
                                .font(.caption2.weight(.bold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(.green.opacity(0.2))
                                .foregroundStyle(.green)
                                .clipShape(Capsule())
                        }
                    }

                    HStack(spacing: 12) {
                        Label(provider.provider_type, systemImage: "gear")
                        Label(provider.purpose, systemImage: provider.purpose == "chat" ? "bubble.left.fill" : (provider.purpose == "tts" || provider.purpose == "stt") ? "speaker.wave.2.fill" : "waveform")
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)

                    if let hasKey = provider.has_api_key {
                        HStack(spacing: 4) {
                            Image(systemName: hasKey ? "checkmark.circle.fill" : "xmark.circle")
                                .foregroundStyle(hasKey ? .green : .red)
                            Text(hasKey ? "API Key configured" : "No API Key")
                        }
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) {
                        Task { await vm.deleteProvider(provider.id) }
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("LLM Providers")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showAddSheet = true } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .refreshable { await vm.loadProviders() }
        .sheet(isPresented: $showAddSheet) {
            AddLLMProviderView(vm: vm, isPresented: $showAddSheet)
        }
        .task { await vm.loadProviders() }
    }

    private func providerIcon(_ type: String) -> String {
        switch type {
        case "azure-openai": return "cloud.fill"
        case "openai":       return "brain"
        case "anthropic":    return "sparkles"
        case "litellm":      return "bolt.fill"
        default:             return "cpu"
        }
    }
}

/// Add new LLM provider form.
struct AddLLMProviderView: View {
    @ObservedObject var vm: SettingsViewModel
    @Binding var isPresented: Bool

    @State private var label = ""
    @State private var providerType = "openai"
    @State private var purpose = "chat"
    @State private var apiKey = ""
    @State private var model = ""
    @State private var endpoint = ""
    @State private var deployment = ""
    @State private var baseURL = ""
    @State private var isDefault = false

    let providerTypes = ["openai", "azure-openai", "anthropic", "litellm"]
    let purposes = ["chat", "embedding", "tts", "stt"]

    var body: some View {
        NavigationStack {
            Form {
                Section("Provider") {
                    TextField("Label", text: $label)
                    Picker("Type", selection: $providerType) {
                        ForEach(providerTypes, id: \.self) { Text($0) }
                    }
                    Picker("Purpose", selection: $purpose) {
                        ForEach(purposes, id: \.self) { Text($0) }
                    }
                    Toggle("Default Provider", isOn: $isDefault)
                }

                Section("Configuration") {
                    SecureField("API Key", text: $apiKey)

                    if providerType == "openai" || providerType == "anthropic" {
                        TextField("Model (optional)", text: $model)
                    }

                    if providerType == "openai" || providerType == "litellm" {
                        TextField("Base URL (optional)", text: $baseURL)
                    }

                    if providerType == "litellm" {
                        TextField("Model", text: $model)
                    }

                    if providerType == "azure-openai" {
                        TextField("Endpoint", text: $endpoint)
                        TextField("Deployment", text: $deployment)
                    }
                }
            }
            .navigationTitle("Add Provider")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { isPresented = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            let config = LLMProviderConfig(
                                apiKey: apiKey.isEmpty ? nil : apiKey,
                                model: model.isEmpty ? nil : model,
                                endpoint: endpoint.isEmpty ? nil : endpoint,
                                deployment: deployment.isEmpty ? nil : deployment,
                                apiVersion: nil,
                                baseURL: baseURL.isEmpty ? nil : baseURL,
                                routingTier: nil,
                                capabilities: nil
                            )
                            let req = LLMProviderCreateRequest(
                                label: label,
                                provider_type: providerType,
                                purpose: purpose,
                                config: config,
                                is_default: isDefault
                            )
                            if await vm.createProvider(req) {
                                isPresented = false
                            }
                        }
                    }
                    .disabled(label.isEmpty || apiKey.isEmpty)
                }
            }
        }
    }
}
