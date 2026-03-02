import Foundation

struct Message: Codable, Identifiable, Equatable {
    let id: Int
    let thread_id: String
    let role: String
    let content: String?
    let tool_calls: String?
    let tool_results: String?
    let attachments: String?
    let created_at: String?

    var createdDate: Date? {
        guard let str = created_at else { return nil }
        return ISO8601DateFormatter().date(from: str)
            ?? DateFormatter.nexusFormatter.date(from: str)
    }

    var parsedToolCalls: [ToolCall] {
        guard let json = tool_calls, let data = json.data(using: .utf8) else { return [] }
        return (try? JSONDecoder().decode([ToolCall].self, from: data)) ?? []
    }

    var parsedAttachments: [AttachmentMeta] {
        guard let json = attachments, let data = json.data(using: .utf8) else { return [] }
        return (try? JSONDecoder().decode([AttachmentMeta].self, from: data)) ?? []
    }
}

struct ToolCall: Codable, Equatable {
    let id: String
    let name: String
    let arguments: AnyCodable?

    enum CodingKeys: String, CodingKey {
        case id, name, arguments
    }
}

struct AttachmentMeta: Codable, Identifiable, Equatable {
    let id: String
    let filename: String
    let mimeType: String
    let sizeBytes: Int
    let storagePath: String
}
