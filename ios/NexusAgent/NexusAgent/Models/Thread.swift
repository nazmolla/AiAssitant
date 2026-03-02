import Foundation

struct NexusThread: Codable, Identifiable, Hashable {
    let id: String
    var title: String
    var status: String
    let last_message_at: String?
    let user_id: String?
    let created_at: String?

    var lastMessageDate: Date? {
        guard let str = last_message_at else { return nil }
        return ISO8601DateFormatter().date(from: str)
            ?? DateFormatter.nexusFormatter.date(from: str)
    }
}

struct ThreadDetail: Codable {
    let thread: NexusThread
    let messages: [Message]
}
