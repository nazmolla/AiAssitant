import SwiftUI

/// Thread list sidebar showing all chat conversations.
struct ThreadListView: View {
    @EnvironmentObject var chatVM: ChatViewModel

    var body: some View {
        List {
            ForEach(chatVM.threads) { thread in
                Button {
                    Task { await chatVM.selectThread(thread) }
                } label: {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(thread.title ?? "Untitled Chat")
                                .font(.headline)
                                .lineLimit(1)

                            if let date = thread.lastMessageDate {
                                Text(date, style: .relative)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }

                        Spacer()

                        if thread.status == "awaiting_approval" {
                            Image(systemName: "exclamationmark.circle.fill")
                                .foregroundStyle(.orange)
                                .font(.caption)
                        }

                        if chatVM.activeThread?.id == thread.id {
                            Image(systemName: "chevron.right")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 4)
                }
                .listRowBackground(
                    chatVM.activeThread?.id == thread.id
                        ? Color.accentColor.opacity(0.1)
                        : Color.clear
                )
            }
            .onDelete { indexSet in
                for index in indexSet {
                    let thread = chatVM.threads[index]
                    Task { await chatVM.deleteThread(thread) }
                }
            }
        }
        .listStyle(.plain)
        .navigationTitle("Chats")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task {
                        if let thread = await chatVM.createThread() {
                            await chatVM.selectThread(thread)
                        }
                    }
                } label: {
                    Image(systemName: "plus.message")
                }
            }
        }
        .refreshable {
            await chatVM.loadThreads()
        }
        .overlay {
            if chatVM.threads.isEmpty && !chatVM.isLoadingThreads {
                ContentUnavailableView {
                    Label("No Chats", systemImage: "message")
                } description: {
                    Text("Start a new conversation")
                } actions: {
                    Button("New Chat") {
                        Task {
                            if let thread = await chatVM.createThread() {
                                await chatVM.selectThread(thread)
                            }
                        }
                    }
                    .buttonStyle(.borderedProminent)
                }
            }
        }
    }
}
