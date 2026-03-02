import Foundation

struct ApprovalRequest: Codable, Identifiable, Equatable {
    let id: String
    let thread_id: String?
    let tool_name: String
    let args: String                 // JSON stringified arguments
    let reasoning: String?
    let status: String               // 'pending' | 'approved' | 'rejected'
    let created_at: String?

    var parsedArgs: [String: AnyCodable]? {
        guard let data = args.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode([String: AnyCodable].self, from: data)
    }

    var createdDate: Date? {
        guard let str = created_at else { return nil }
        return DateFormatter.nexusFormatter.date(from: str)
    }
}

struct ApprovalAction: Codable {
    let approvalId: String
    let action: String               // 'approved' | 'rejected'
}
