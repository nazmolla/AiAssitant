import Foundation

struct AgentLog: Codable, Identifiable, Equatable {
    let id: Int
    let level: String                // 'verbose' | 'warning' | 'error' | 'critical'
    let source: String?
    let message: String
    let metadata: String?            // JSON string
    let created_at: String?

    var createdDate: Date? {
        guard let str = created_at else { return nil }
        return DateFormatter.nexusFormatter.date(from: str)
    }

    var levelColor: String {
        switch level {
        case "verbose":  return "secondary"
        case "warning":  return "orange"
        case "error":    return "red"
        case "critical": return "purple"
        default:         return "primary"
        }
    }
}

struct LogDeleteRequest: Codable {
    let mode: String                 // 'all' | 'level' | 'older-than-days'
    let level: String?
    let days: Int?
}
