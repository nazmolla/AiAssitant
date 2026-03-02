import SwiftUI

/// Main chat view with messages and input bar.
struct ChatView: View {
    @EnvironmentObject var chatVM: ChatViewModel

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if chatVM.activeThread == nil {
                    // Empty state
                    ContentUnavailableView {
                        Label("Select a Chat", systemImage: "message")
                    } description: {
                        Text("Choose a conversation from the Chats tab or start a new one.")
                    }
                } else {
                    // Messages
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(spacing: 12) {
                                ForEach(chatVM.messages) { message in
                                    MessageBubbleView(message: message)
                                        .id(message.id)
                                }

                                // Thinking indicator
                                if let status = chatVM.streamingStatus {
                                    ThinkingBlockView(status: status)
                                        .id("thinking")
                                }

                                // Error
                                if let error = chatVM.error {
                                    HStack {
                                        Image(systemName: "exclamationmark.triangle.fill")
                                            .foregroundStyle(.red)
                                        Text(error)
                                            .font(.caption)
                                            .foregroundStyle(.red)
                                    }
                                    .padding()
                                    .id("error")
                                }
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                        }
                        .onChange(of: chatVM.messages.count) { _, _ in
                            scrollToBottom(proxy)
                        }
                        .onChange(of: chatVM.streamingStatus) { _, _ in
                            if chatVM.streamingStatus != nil {
                                withAnimation {
                                    proxy.scrollTo("thinking", anchor: .bottom)
                                }
                            }
                        }
                    }

                    // Input bar
                    ChatInputView()
                }
            }
            .navigationTitle(chatVM.activeThread?.title ?? "Chat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if chatVM.activeThread != nil {
                    ToolbarItem(placement: .primaryAction) {
                        Menu {
                            Button(role: .destructive) {
                                if let thread = chatVM.activeThread {
                                    Task { await chatVM.deleteThread(thread) }
                                }
                            } label: {
                                Label("Delete Chat", systemImage: "trash")
                            }
                        } label: {
                            Image(systemName: "ellipsis.circle")
                        }
                    }
                }
            }
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        guard let lastId = chatVM.messages.last?.id else { return }
        withAnimation(.easeOut(duration: 0.2)) {
            proxy.scrollTo(lastId, anchor: .bottom)
        }
    }
}
