import SwiftUI

/// Admin user management — list users, toggle enabled, change roles, manage permissions.
struct AdminUsersView: View {
    @StateObject private var vm = AdminViewModel()
    @State private var selectedUser: User?

    var body: some View {
        List {
            ForEach(vm.users) { user in
                Button {
                    selectedUser = user
                } label: {
                    HStack {
                        // Avatar
                        Circle()
                            .fill(user.isAdmin ? .purple.opacity(0.3) : .blue.opacity(0.3))
                            .frame(width: 36, height: 36)
                            .overlay {
                                Text(String(user.display_name.prefix(1).uppercased()))
                                    .font(.headline)
                                    .foregroundStyle(user.isAdmin ? .purple : .blue)
                            }

                        VStack(alignment: .leading, spacing: 2) {
                            Text(user.display_name.isEmpty ? user.email : user.display_name)
                                .font(.headline)
                            Text(user.email)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        VStack(alignment: .trailing, spacing: 4) {
                            Text(user.role.uppercased())
                                .font(.caption2.weight(.bold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(user.isAdmin ? .purple.opacity(0.2) : .blue.opacity(0.2))
                                .foregroundStyle(user.isAdmin ? .purple : .blue)
                                .clipShape(Capsule())

                            Circle()
                                .fill(user.isEnabled ? .green : .red)
                                .frame(width: 8, height: 8)
                        }
                    }
                }
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) {
                        Task { await vm.deleteUser(user.id) }
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Users")
        .refreshable { await vm.load() }
        .sheet(item: $selectedUser) { user in
            UserDetailView(vm: vm, user: user)
        }
        .task { await vm.load() }
    }
}

/// User detail/edit view for admins.
struct UserDetailView: View {
    @ObservedObject var vm: AdminViewModel
    let user: User
    @Environment(\.dismiss) private var dismiss

    @State private var role: String
    @State private var enabled: Bool
    @State private var permissions: UserPermissions

    init(vm: AdminViewModel, user: User) {
        self.vm = vm
        self.user = user
        _role = State(initialValue: user.role)
        _enabled = State(initialValue: user.isEnabled)
        _permissions = State(initialValue: user.permissions ?? UserPermissions())
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("User Info") {
                    LabeledContent("Email", value: user.email)
                    LabeledContent("Display Name", value: user.display_name)
                    LabeledContent("Provider", value: user.provider_id)
                }

                Section("Role & Status") {
                    Picker("Role", selection: $role) {
                        Text("User").tag("user")
                        Text("Admin").tag("admin")
                    }
                    Toggle("Enabled", isOn: $enabled)
                }

                Section("Permissions") {
                    permissionToggle("Chat", key: \.chat)
                    permissionToggle("Knowledge", key: \.knowledge)
                    permissionToggle("Dashboard", key: \.dashboard)
                    permissionToggle("Approvals", key: \.approvals)
                    permissionToggle("MCP Servers", key: \.mcp_servers)
                    permissionToggle("Channels", key: \.channels)
                    permissionToggle("LLM Config", key: \.llm_config)
                    permissionToggle("Screen Sharing", key: \.screen_sharing)
                }
            }
            .navigationTitle("Edit User")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            permissions.user_id = user.id
                            if await vm.updateUser(
                                id: user.id,
                                role: role,
                                enabled: enabled ? 1 : 0,
                                permissions: permissions
                            ) {
                                dismiss()
                            }
                        }
                    }
                }
            }
        }
    }

    private func permissionToggle(_ label: String, key: WritableKeyPath<UserPermissions, Int?>) -> some View {
        Toggle(label, isOn: Binding(
            get: { (permissions[keyPath: key] ?? 1) == 1 },
            set: { permissions[keyPath: key] = $0 ? 1 : 0 }
        ))
    }
}

extension User: @retroactive Identifiable {}
