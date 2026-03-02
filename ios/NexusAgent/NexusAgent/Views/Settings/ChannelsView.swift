import SwiftUI

/// Channel management — WhatsApp, Slack, Email, Telegram, Discord, Teams.
struct ChannelsView: View {
    @StateObject private var vm = SettingsViewModel()

    var body: some View {
        List {
            if vm.channels.isEmpty && !vm.isLoading {
                ContentUnavailableView {
                    Label("No Channels", systemImage: "antenna.radiowaves.left.and.right")
                } description: {
                    Text("Configure messaging channels to connect the agent to external platforms.")
                }
            }

            ForEach(vm.channels) { channel in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Image(systemName: channel.channelIcon)
                            .foregroundStyle(.accentColor)
                        Text(channel.label)
                            .font(.headline)
                        Spacer()

                        // Enabled toggle
                        Toggle("", isOn: Binding(
                            get: { channel.isEnabled },
                            set: { newValue in
                                Task {
                                    let req = ChannelUpdateRequest(
                                        id: channel.id,
                                        label: nil,
                                        channelType: nil,
                                        config: nil,
                                        enabled: newValue ? 1 : 0
                                    )
                                    _ = await vm.updateChannel(req)
                                }
                            }
                        ))
                        .labelsHidden()
                    }

                    Label(channel.channel_type.capitalized, systemImage: "tag")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 4)
                .swipeActions(edge: .trailing) {
                    Button(role: .destructive) {
                        Task { await vm.deleteChannel(channel.id) }
                    } label: {
                        Label("Delete", systemImage: "trash")
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Channels")
        .refreshable { await vm.loadChannels() }
        .task { await vm.loadChannels() }
    }
}
