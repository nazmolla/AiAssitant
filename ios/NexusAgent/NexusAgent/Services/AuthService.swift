import Foundation

/// Handles authentication via NextAuth's credential flow.
/// Flow: GET /api/auth/csrf → POST /api/auth/callback/credentials → session cookie stored
final class AuthService {
    static let shared = AuthService()
    private let api = APIClient.shared
    private let keychain = KeychainService.shared

    private init() {}

    // MARK: - Login

    /// Authenticate with email and password using NextAuth's credential flow.
    /// Returns the authenticated user.
    func login(email: String, password: String) async throws -> MeResponse {
        // 1. Get CSRF token
        let csrfToken = try await fetchCSRFToken()

        // 2. POST credentials (form-encoded, as NextAuth expects)
        let callbackURL = api.baseURL.appendingPathComponent("api/auth/callback/credentials")
        var request = URLRequest(url: callbackURL)
        request.httpMethod = "POST"
        request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")

        let bodyParts = [
            "email=\(urlEncode(email))",
            "password=\(urlEncode(password))",
            "csrfToken=\(urlEncode(csrfToken))",
            "json=true"
        ]
        request.httpBody = bodyParts.joined(separator: "&").data(using: .utf8)

        // Allow redirects — URLSession accumulates cookies from all redirect hops
        let (_, response) = try await api.session.data(for: request)

        // The callback may return 200 (json=true) or redirect to homepage
        // Either way, session cookie is now in the cookie jar

        // 3. Verify session by fetching /api/admin/users/me
        let me: MeResponse = try await api.get("api/admin/users/me")

        // 4. Persist user info
        keychain.save(email, for: .userEmail)
        keychain.save(me.id, for: .userId)
        keychain.save(me.role, for: .userRole)

        return me
    }

    // MARK: - Logout

    func logout() async {
        // Clear NextAuth session
        do {
            let csrfToken = try await fetchCSRFToken()
            let signoutURL = api.baseURL.appendingPathComponent("api/auth/signout")
            var request = URLRequest(url: signoutURL)
            request.httpMethod = "POST"
            request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
            request.httpBody = "csrfToken=\(urlEncode(csrfToken))&json=true".data(using: .utf8)
            _ = try? await api.session.data(for: request)
        } catch { }

        // Clear cookies
        if let cookies = HTTPCookieStorage.shared.cookies(for: api.baseURL) {
            for cookie in cookies {
                HTTPCookieStorage.shared.deleteCookie(cookie)
            }
        }

        // Clear keychain
        keychain.delete(.sessionCookie)
        keychain.delete(.userEmail)
        keychain.delete(.userId)
        keychain.delete(.userRole)
    }

    // MARK: - Session Check

    /// Check if we have a valid session. Returns the current user or nil.
    func checkSession() async -> MeResponse? {
        do {
            let me: MeResponse = try await api.get("api/admin/users/me")
            return me
        } catch {
            return nil
        }
    }

    /// Returns true if we have stored credentials suggesting a prior login.
    var hasSavedSession: Bool {
        keychain.load(.userEmail) != nil
    }

    var savedEmail: String? {
        keychain.load(.userEmail)
    }

    var savedRole: String? {
        keychain.load(.userRole)
    }

    // MARK: - Change Password

    func changePassword(currentPassword: String, newPassword: String) async throws {
        struct ChangePasswordRequest: Codable {
            let currentPassword: String
            let newPassword: String
        }
        try await api.post(
            "api/config/change-password",
            body: ChangePasswordRequest(currentPassword: currentPassword, newPassword: newPassword)
        ) as Void
    }

    // MARK: - Internal

    private struct CSRFResponse: Codable {
        let csrfToken: String
    }

    private func fetchCSRFToken() async throws -> String {
        let url = api.baseURL.appendingPathComponent("api/auth/csrf")
        let (data, response) = try await api.session.data(from: url)

        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw AuthError.csrfFailed
        }

        let csrf = try JSONDecoder().decode(CSRFResponse.self, from: data)
        return csrf.csrfToken
    }

    private func urlEncode(_ string: String) -> String {
        string.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? string
    }
}

// MARK: - Auth Errors

enum AuthError: LocalizedError {
    case csrfFailed
    case invalidCredentials
    case sessionExpired

    var errorDescription: String? {
        switch self {
        case .csrfFailed:         return "Unable to connect to server"
        case .invalidCredentials: return "Invalid email or password"
        case .sessionExpired:     return "Session expired. Please log in again."
        }
    }
}
