import SwiftUI

/// Custom tools management — list, toggle, delete.
struct CustomToolsView: View {
    @StateObject private var vm = SettingsViewModel()

    var body: some View {
        List {
            if vm.customTools.isEmpty && !vm.isLoading {
                ContentUnavailableView {
                    Label("No Custom Tools", systemImage: "wrench.and.screwdriver")
                } description: {
                    Text("Custom tools can be created to extend the agent's capabilities with custom code.")
                }
            }

            ForEach(vm.customTools) { tool in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Image(systemName: "wrench.and.screwdriver")
                            .foregroundStyle(.orange)
                        Text(tool.name)
                            .font(.headline.monospaced())
                        Spacer()

                        Toggle("", isOn: Binding(
                            get: { tool.isEnabled },
                            set: { newValue in
                                Task { await vm.toggleCustomTool(tool.name, enabled: newValue) }
                            }
                        ))
                        .labelsHidden()
                    }

                    Text(tool.description)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)

                    // Implementation preview
                    Text(tool.implementation)
                        .font(.caption.monospaced())
                        .foregroundStyle(.tertiary)
                        .lineLimit(3)
                        .padding(6)
                        .background(.ultraThinMaterial)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                }
                .padding(.vertical, 4)
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) {
                        Task { await vm.deleteCustomTool(tool.name) }
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Custom Tools")
        .refreshable { await vm.loadCustomTools() }
        .task { await vm.loadCustomTools() }
    }
}
