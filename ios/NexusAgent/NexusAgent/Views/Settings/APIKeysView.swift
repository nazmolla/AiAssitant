import SwiftUI

/// API Key management — list, create, delete.
struct APIKeysView: View {
    @StateObject private var vm = SettingsViewModel()
    @State private var showAddSheet = false
    @State private var copiedKey: String?

    var body: some View {
        List {
            // Newly created key banner
            if let rawKey = vm.newlyCreatedKey {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(.orange)
                            Text("Copy your API key now!")
                                .font(.subheadline.weight(.semibold))
                        }

                        Text(rawKey)
                            .font(.caption.monospaced())
                            .textSelection(.enabled)
                            .padding(8)
                            .background(.ultraThinMaterial)
                            .clipShape(RoundedRectangle(cornerRadius: 6))

                        Text("This key will not be shown again.")
                            .font(.caption)
                            .foregroundStyle(.secondary)

                        Button {
                            UIPasteboard.general.string = rawKey
                            copiedKey = rawKey
                        } label: {
                            Label(copiedKey == rawKey ? "Copied!" : "Copy to Clipboard",
                                  systemImage: copiedKey == rawKey ? "checkmark" : "doc.on.doc")
                        }
                        .buttonStyle(.bordered)
                    }
                }
            }

            // Key list
            ForEach(vm.apiKeys) { key in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Image(systemName: "key.fill")
                            .foregroundStyle(.accentColor)
                        Text(key.name)
                            .font(.headline)
                        Spacer()
                        Text(key.key_prefix + "…")
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                    }

                    HStack(spacing: 8) {
                        ForEach(key.parsedScopes, id: \.self) { scope in
                            Text(scope)
                                .font(.caption2)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(.blue.opacity(0.15))
                                .clipShape(Capsule())
                        }
                    }

                    HStack {
                        if key.isExpired {
                            Label("Expired", systemImage: "clock.badge.xmark")
                                .font(.caption)
                                .foregroundStyle(.red)
                        } else if let exp = key.expires_at {
                            Label("Expires: \(exp)", systemImage: "clock")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        } else {
                            Label("Never expires", systemImage: "infinity")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(.vertical, 4)
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) {
                        Task { await vm.deleteApiKey(key.id) }
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("API Keys")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showAddSheet = true } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .refreshable { await vm.loadApiKeys() }
        .sheet(isPresented: $showAddSheet) {
            AddAPIKeyView(vm: vm, isPresented: $showAddSheet)
        }
        .task { await vm.loadApiKeys() }
    }
}

/// Add new API key form.
struct AddAPIKeyView: View {
    @ObservedObject var vm: SettingsViewModel
    @Binding var isPresented: Bool

    @State private var name = ""
    @State private var selectedScopes: Set<String> = ["chat"]
    @State private var hasExpiry = false
    @State private var expiryDate = Date().addingTimeInterval(86400 * 30) // 30 days

    let allScopes = ["chat", "knowledge", "approvals", "threads"]

    var body: some View {
        NavigationStack {
            Form {
                Section("Key Details") {
                    TextField("Key Name", text: $name)
                }

                Section("Scopes") {
                    ForEach(allScopes, id: \.self) { scope in
                        Toggle(scope.capitalized, isOn: Binding(
                            get: { selectedScopes.contains(scope) },
                            set: { isOn in
                                if isOn { selectedScopes.insert(scope) }
                                else { selectedScopes.remove(scope) }
                            }
                        ))
                    }
                }

                Section("Expiration") {
                    Toggle("Set Expiry", isOn: $hasExpiry)
                    if hasExpiry {
                        DatePicker("Expires", selection: $expiryDate, in: Date()..., displayedComponents: .date)
                    }
                }
            }
            .navigationTitle("Create API Key")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { isPresented = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        Task {
                            let expiry = hasExpiry ? ISO8601DateFormatter().string(from: expiryDate) : nil
                            if await vm.createApiKey(
                                name: name,
                                scopes: Array(selectedScopes),
                                expiresAt: expiry
                            ) {
                                isPresented = false
                            }
                        }
                    }
                    .disabled(name.isEmpty || selectedScopes.isEmpty)
                }
            }
        }
    }
}
