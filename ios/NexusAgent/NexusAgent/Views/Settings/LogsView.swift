import SwiftUI

/// Agent logs viewer with filtering and clearing.
struct LogsView: View {
    @StateObject private var vm = LogsViewModel()
    @State private var showClearOptions = false

    var body: some View {
        VStack(spacing: 0) {
            // Filters
            HStack(spacing: 8) {
                Picker("Level", selection: $vm.levelFilter) {
                    Text("All Levels").tag("")
                    Text("Verbose").tag("verbose")
                    Text("Warning").tag("warning")
                    Text("Error").tag("error")
                    Text("Critical").tag("critical")
                }
                .pickerStyle(.menu)
                .onChange(of: vm.levelFilter) { _, _ in
                    Task { await vm.load() }
                }

                Spacer()

                Text("\(vm.logs.count) entries")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal)
            .padding(.vertical, 8)

            Divider()

            // Log entries
            List {
                ForEach(vm.logs) { log in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            // Level badge
                            Text(log.level.uppercased())
                                .font(.caption2.weight(.bold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(levelColor(log.level).opacity(0.2))
                                .foregroundStyle(levelColor(log.level))
                                .clipShape(Capsule())

                            if let source = log.source, !source.isEmpty {
                                Text(source)
                                    .font(.caption.monospaced())
                                    .foregroundStyle(.secondary)
                            }

                            Spacer()

                            if let date = log.createdDate {
                                Text(date, style: .time)
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                        }

                        Text(log.message)
                            .font(.subheadline)
                            .lineLimit(3)

                        if let meta = log.metadata, !meta.isEmpty {
                            Text(meta)
                                .font(.caption2.monospaced())
                                .foregroundStyle(.tertiary)
                                .lineLimit(2)
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
            .listStyle(.plain)
        }
        .navigationTitle("Agent Logs")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Button(role: .destructive) {
                        Task { await vm.clearAll() }
                    } label: {
                        Label("Clear All", systemImage: "trash")
                    }

                    Button {
                        Task { await vm.clearOlderThan(days: 7) }
                    } label: {
                        Label("Clear Older Than 7 Days", systemImage: "calendar.badge.minus")
                    }

                    Button {
                        Task { await vm.clearByLevel("verbose") }
                    } label: {
                        Label("Clear Verbose Logs", systemImage: "text.line.first.and.arrowtriangle.forward")
                    }
                } label: {
                    Image(systemName: "trash")
                }
            }
        }
        .refreshable { await vm.load() }
        .task { await vm.load() }
    }

    private func levelColor(_ level: String) -> Color {
        switch level {
        case "verbose":  return .gray
        case "warning":  return .orange
        case "error":    return .red
        case "critical": return .purple
        default:         return .primary
        }
    }
}
