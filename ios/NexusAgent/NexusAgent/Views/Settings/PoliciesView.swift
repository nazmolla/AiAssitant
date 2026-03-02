import SwiftUI

/// Tool policies management — approval requirements and proactive mode.
struct PoliciesView: View {
    @StateObject private var vm = SettingsViewModel()

    var body: some View {
        List {
            if vm.policies.isEmpty && !vm.isLoading {
                ContentUnavailableView {
                    Label("No Policies", systemImage: "shield.checkered")
                } description: {
                    Text("Tool policies are configured automatically when MCP servers connect.")
                }
            }

            ForEach(vm.policies) { policy in
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Image(systemName: "wrench.and.screwdriver")
                            .foregroundStyle(.orange)
                        Text(policy.tool_name)
                            .font(.headline.monospaced())
                    }

                    Toggle("Requires Approval", isOn: Binding(
                        get: { policy.requiresApproval },
                        set: { newValue in
                            Task {
                                let req = PolicyCreateRequest(
                                    tool_name: policy.tool_name,
                                    mcp_id: policy.mcp_id,
                                    requires_approval: newValue ? 1 : 0,
                                    is_proactive_enabled: policy.is_proactive_enabled
                                )
                                _ = await vm.savePolicy(req)
                            }
                        }
                    ))

                    Toggle("Proactive Mode", isOn: Binding(
                        get: { policy.isProactiveEnabled },
                        set: { newValue in
                            Task {
                                let req = PolicyCreateRequest(
                                    tool_name: policy.tool_name,
                                    mcp_id: policy.mcp_id,
                                    requires_approval: policy.requires_approval,
                                    is_proactive_enabled: newValue ? 1 : 0
                                )
                                _ = await vm.savePolicy(req)
                            }
                        }
                    ))
                }
                .padding(.vertical, 4)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Tool Policies")
        .refreshable { await vm.loadPolicies() }
        .task { await vm.loadPolicies() }
    }
}
