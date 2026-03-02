import Foundation

struct ApiKeyRecord: Codable, Identifiable, Equatable {
    let id: String
    let user_id: String
    let name: String
    let key_prefix: String           // e.g. "nxk_ab12"
    let scopes: String               // JSON array: '["chat","knowledge"]'
    let expires_at: String?
    let last_used_at: String?
    let created_at: String?

    /// The raw key is only returned once at creation time
    var rawKey: String?

    var parsedScopes: [String] {
        guard let data = scopes.data(using: .utf8),
              let arr = try? JSONDecoder().decode([String].self, from: data) else {
            return []
        }
        return arr
    }

    var isExpired: Bool {
        guard let exp = expires_at,
              let date = DateFormatter.nexusFormatter.date(from: exp) else { return false }
        return date < Date()
    }
}

struct ApiKeyCreateRequest: Codable {
    let name: String
    let scopes: [String]?
    let expiresAt: String?
}

struct ApiKeyDeleteRequest: Codable {
    let id: String
}
