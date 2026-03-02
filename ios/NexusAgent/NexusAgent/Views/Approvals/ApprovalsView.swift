import SwiftUI

/// Approval queue showing pending tool execution requests.
struct ApprovalsView: View {
    @StateObject private var vm = ApprovalsViewModel()

    var body: some View {
        NavigationStack {
            List {
                if vm.approvals.isEmpty && !vm.isLoading {
                    ContentUnavailableView {
                        Label("No Pending Approvals", systemImage: "checkmark.shield")
                    } description: {
                        Text("Tool execution requests requiring approval will appear here.")
                    }
                }

                ForEach(vm.approvals) { approval in
                    ApprovalCardView(approval: approval) {
                        await vm.approve(approval)
                    } onReject: {
                        await vm.reject(approval)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Approvals")
            .refreshable {
                await vm.load()
            }
            .alert("Error", isPresented: .init(
                get: { vm.error != nil },
                set: { if !$0 { vm.error = nil } }
            )) {
                Button("OK") { vm.error = nil }
            } message: {
                Text(vm.error ?? "")
            }
            .task { await vm.load() }
        }
    }
}

/// Individual approval card with approve/reject actions.
struct ApprovalCardView: View {
    let approval: ApprovalRequest
    let onApprove: () async -> Void
    let onReject: () async -> Void

    @State private var showArgs = false
    @State private var isProcessing = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            // Tool name & status
            HStack {
                Image(systemName: "wrench.and.screwdriver")
                    .foregroundStyle(.orange)
                Text(approval.tool_name)
                    .font(.headline.monospaced())

                Spacer()

                Text(approval.status.uppercased())
                    .font(.caption2.weight(.bold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(statusColor.opacity(0.2))
                    .foregroundStyle(statusColor)
                    .clipShape(Capsule())
            }

            // Reasoning
            if let reasoning = approval.reasoning, !reasoning.isEmpty {
                Text(reasoning)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            // Arguments (collapsible)
            DisclosureGroup("Arguments", isExpanded: $showArgs) {
                if let args = approval.parsedArgs {
                    ForEach(Array(args.keys.sorted()), id: \.self) { key in
                        HStack {
                            Text(key)
                                .font(.caption.monospaced())
                                .foregroundStyle(.secondary)
                            Spacer()
                            Text("\(args[key]?.prettyPrinted ?? "null")")
                                .font(.caption.monospaced())
                                .lineLimit(3)
                        }
                    }
                } else {
                    Text(approval.args)
                        .font(.caption.monospaced())
                        .lineLimit(5)
                }
            }
            .font(.caption)

            // Actions (only for pending)
            if approval.status == "pending" {
                HStack(spacing: 12) {
                    Spacer()

                    Button {
                        isProcessing = true
                        Task {
                            await onReject()
                            isProcessing = false
                        }
                    } label: {
                        Label("Reject", systemImage: "xmark.circle")
                            .font(.subheadline)
                    }
                    .buttonStyle(.bordered)
                    .tint(.red)

                    Button {
                        isProcessing = true
                        Task {
                            await onApprove()
                            isProcessing = false
                        }
                    } label: {
                        Label("Approve", systemImage: "checkmark.circle")
                            .font(.subheadline)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.green)
                }
                .disabled(isProcessing)
            }

            // Timestamp
            if let date = approval.createdDate {
                Text(date, style: .relative)
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 4)
    }

    private var statusColor: Color {
        switch approval.status {
        case "pending":  return .orange
        case "approved": return .green
        case "rejected": return .red
        default:         return .gray
        }
    }
}
