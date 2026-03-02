import Foundation
import SwiftUI

/// Manages chat threads and active conversation state.
@MainActor
final class ChatViewModel: ObservableObject {
    // Thread list
    @Published var threads: [NexusThread] = []
    @Published var isLoadingThreads = false

    // Active chat
    @Published var activeThread: NexusThread?
    @Published var messages: [Message] = []
    @Published var isStreaming = false
    @Published var streamingStatus: String?
    @Published var inputText = ""

    // Error handling
    @Published var error: String?

    private let api = APIClient.shared
    private var sseClient: SSEClient?

    // MARK: - Threads

    func loadThreads() async {
        isLoadingThreads = true
        defer { isLoadingThreads = false }

        do {
            threads = try await api.get("api/threads")
        } catch {
            self.error = error.localizedDescription
        }
    }

    func createThread() async -> NexusThread? {
        do {
            struct CreateBody: Codable {
                let title: String
            }
            let thread: NexusThread = try await api.post("api/threads", body: CreateBody(title: "New Chat"))
            threads.insert(thread, at: 0)
            return thread
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }

    func deleteThread(_ thread: NexusThread) async {
        do {
            try await api.delete("api/threads/\(thread.id)")
            threads.removeAll { $0.id == thread.id }
            if activeThread?.id == thread.id {
                activeThread = nil
                messages = []
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Messages

    func loadMessages(for thread: NexusThread) async {
        activeThread = thread
        messages = []

        do {
            let detail: ThreadDetail = try await api.get("api/threads/\(thread.id)")
            messages = detail.messages
        } catch {
            self.error = error.localizedDescription
        }
    }

    func selectThread(_ thread: NexusThread) async {
        await loadMessages(for: thread)
    }

    // MARK: - Send Message (SSE Streaming)

    func sendMessage(attachmentIds: [String]? = nil) async {
        guard let thread = activeThread else { return }
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        // Add user message optimistically
        let userMsg = Message(
            id: Int.random(in: 100000...999999),
            thread_id: thread.id,
            role: "user",
            content: text,
            tool_calls: nil,
            tool_results: nil,
            attachments: nil,
            created_at: ISO8601DateFormatter().string(from: Date())
        )
        messages.append(userMsg)
        inputText = ""
        isStreaming = true
        streamingStatus = nil
        error = nil

        let client = SSEClient()
        sseClient = client

        client.stream(
            threadId: thread.id,
            message: text,
            attachmentIds: attachmentIds,
            onStatus: { [weak self] status in
                self?.streamingStatus = status
            },
            onMessage: { [weak self] message in
                self?.streamingStatus = nil
                // Replace or append the assistant message
                if let idx = self?.messages.lastIndex(where: { $0.role == "assistant" && $0.id == message.id }) {
                    self?.messages[idx] = message
                } else {
                    self?.messages.append(message)
                }
            },
            onDone: { [weak self] in
                self?.isStreaming = false
                self?.streamingStatus = nil
                self?.sseClient = nil
                // Refresh thread list to update last_message_at
                Task { await self?.loadThreads() }
            },
            onError: { [weak self] errorMsg in
                self?.isStreaming = false
                self?.streamingStatus = nil
                self?.error = errorMsg
                self?.sseClient = nil
            }
        )
    }

    func cancelStreaming() {
        sseClient?.cancel()
        sseClient = nil
        isStreaming = false
        streamingStatus = nil
    }

    // MARK: - Attachments

    func uploadAttachment(data: Data, filename: String, mimeType: String) async -> String? {
        guard let thread = activeThread else { return nil }
        do {
            let result = try await api.upload(
                "api/attachments",
                fileData: data,
                filename: filename,
                mimeType: mimeType,
                additionalFields: ["threadId": thread.id]
            )
            return result["id"]?.value as? String
        } catch {
            self.error = error.localizedDescription
            return nil
        }
    }
}
