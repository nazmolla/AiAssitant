import Foundation

struct User: Codable, Identifiable, Equatable {
    let id: String
    let email: String
    let display_name: String
    let provider_id: String          // 'local' | 'azure-ad' | 'google'
    let external_sub_id: String?
    let role: String                 // 'admin' | 'user'
    let enabled: Int                 // 0 = disabled, 1 = enabled
    let created_at: String?
    let permissions: UserPermissions?

    var isAdmin: Bool { role == "admin" }
    var isEnabled: Bool { enabled == 1 }
}

struct UserPermissions: Codable, Equatable {
    var user_id: String?
    var chat: Int?
    var knowledge: Int?
    var dashboard: Int?
    var approvals: Int?
    var mcp_servers: Int?
    var channels: Int?
    var llm_config: Int?
    var screen_sharing: Int?

    func isAllowed(_ permission: String) -> Bool {
        switch permission {
        case "chat":           return (chat ?? 1) == 1
        case "knowledge":      return (knowledge ?? 1) == 1
        case "dashboard":      return (dashboard ?? 1) == 1
        case "approvals":      return (approvals ?? 1) == 1
        case "mcp_servers":    return (mcp_servers ?? 1) == 1
        case "channels":       return (channels ?? 0) == 1
        case "llm_config":     return (llm_config ?? 0) == 1
        case "screen_sharing": return (screen_sharing ?? 1) == 1
        default:               return false
        }
    }
}

/// Partial update for admin user operations
struct UserUpdateRequest: Codable {
    let id: String
    let role: String?
    let enabled: Int?
    let permissions: UserPermissions?
}

/// Response from /api/admin/users/me
struct MeResponse: Codable {
    let id: String
    let email: String
    let display_name: String?
    let role: String
}
