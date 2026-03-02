import SwiftUI

/// MCP Server management — list, add, delete.
struct MCPServersView: View {
    @StateObject private var vm = SettingsViewModel()
    @State private var showAddSheet = false

    var body: some View {
        List {
            if vm.mcpServers.isEmpty && !vm.isLoading {
                ContentUnavailableView {
                    Label("No MCP Servers", systemImage: "server.rack")
                } description: {
                    Text("Add Model Context Protocol servers to extend agent capabilities.")
                }
            }

            ForEach(vm.mcpServers) { server in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Image(systemName: server.transportIcon)
                            .foregroundStyle(.accentColor)
                        Text(server.name)
                            .font(.headline)
                        Spacer()

                        // Connection status
                        Circle()
                            .fill(server.connected == true ? .green : .red)
                            .frame(width: 8, height: 8)
                    }

                    HStack(spacing: 12) {
                        if let transport = server.transport_type {
                            Label(transport, systemImage: "arrow.left.arrow.right")
                        }
                        if let scope = server.scope {
                            Label(scope, systemImage: scope == "global" ? "globe" : "person")
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)

                    if let url = server.url, !url.isEmpty {
                        Text(url)
                            .font(.caption.monospaced())
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                    }

                    if let command = server.command, !command.isEmpty {
                        Text(command)
                            .font(.caption.monospaced())
                            .foregroundStyle(.tertiary)
                            .lineLimit(1)
                    }
                }
                .padding(.vertical, 4)
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) {
                        Task { await vm.deleteMCPServer(server.id) }
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("MCP Servers")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showAddSheet = true } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .refreshable { await vm.loadMCPServers() }
        .sheet(isPresented: $showAddSheet) {
            AddMCPServerView(vm: vm, isPresented: $showAddSheet)
        }
        .task { await vm.loadMCPServers() }
    }
}

/// Add new MCP server form.
struct AddMCPServerView: View {
    @ObservedObject var vm: SettingsViewModel
    @Binding var isPresented: Bool

    @State private var name = ""
    @State private var transportType = "stdio"
    @State private var command = ""
    @State private var argsText = ""
    @State private var url = ""
    @State private var authType = "none"
    @State private var accessToken = ""
    @State private var scope = "global"

    let transportTypes = ["stdio", "sse", "streamable-http"]
    let authTypes = ["none", "bearer", "oauth"]
    let scopes = ["global", "user"]

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    TextField("Name", text: $name)
                    Picker("Transport", selection: $transportType) {
                        ForEach(transportTypes, id: \.self) { Text($0) }
                    }
                    Picker("Scope", selection: $scope) {
                        ForEach(scopes, id: \.self) { Text($0.capitalized) }
                    }
                }

                if transportType == "stdio" {
                    Section("Command") {
                        TextField("Command (e.g. npx)", text: $command)
                        TextField("Arguments (comma-separated)", text: $argsText)
                    }
                } else {
                    Section("Connection") {
                        TextField("URL", text: $url)
                            .keyboardType(.URL)
                            .autocapitalization(.none)
                    }
                }

                Section("Authentication") {
                    Picker("Auth Type", selection: $authType) {
                        ForEach(authTypes, id: \.self) { Text($0.capitalized) }
                    }
                    if authType == "bearer" {
                        SecureField("Access Token", text: $accessToken)
                    }
                }
            }
            .navigationTitle("Add MCP Server")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { isPresented = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            let args = argsText.isEmpty ? nil : argsText.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) }
                            let req = MCPServerCreateRequest(
                                name: name,
                                transport_type: transportType,
                                command: command.isEmpty ? nil : command,
                                args: args,
                                env_vars: nil,
                                url: url.isEmpty ? nil : url,
                                auth_type: authType,
                                access_token: accessToken.isEmpty ? nil : accessToken,
                                client_id: nil,
                                client_secret: nil,
                                scope: scope
                            )
                            if await vm.createMCPServer(req) {
                                isPresented = false
                            }
                        }
                    }
                    .disabled(name.isEmpty)
                }
            }
        }
    }
}
