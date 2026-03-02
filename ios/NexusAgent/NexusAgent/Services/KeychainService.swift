import Foundation
import Security

/// Secure storage for sensitive data (session cookies, server URL)
final class KeychainService {
    static let shared = KeychainService()
    private init() {}

    private let service = "com.nexus.agent"

    // MARK: - Keys

    enum Key: String {
        case serverURL     = "nexus_server_url"
        case sessionCookie = "nexus_session_cookie"
        case userEmail     = "nexus_user_email"
        case userId        = "nexus_user_id"
        case userRole      = "nexus_user_role"
    }

    // MARK: - Save

    func save(_ value: String, for key: Key) {
        guard let data = value.data(using: .utf8) else { return }

        // Delete existing
        let deleteQuery: [String: Any] = [
            kSecClass as String:       kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
        ]
        SecItemDelete(deleteQuery as CFDictionary)

        // Add new
        let addQuery: [String: Any] = [
            kSecClass as String:       kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
            kSecValueData as String:   data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]
        SecItemAdd(addQuery as CFDictionary, nil)
    }

    // MARK: - Load

    func load(_ key: Key) -> String? {
        let query: [String: Any] = [
            kSecClass as String:       kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
            kSecReturnData as String:  true,
            kSecMatchLimit as String:  kSecMatchLimitOne,
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    // MARK: - Delete

    func delete(_ key: Key) {
        let query: [String: Any] = [
            kSecClass as String:       kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
        ]
        SecItemDelete(query as CFDictionary)
    }

    // MARK: - Clear All

    func clearAll() {
        for key in [Key.serverURL, .sessionCookie, .userEmail, .userId, .userRole] {
            delete(key)
        }
    }
}
