import Foundation
import SwiftUI

/// Manages authentication state across the app.
@MainActor
final class AuthViewModel: ObservableObject {
    @Published var isAuthenticated = false
    @Published var isLoading = true
    @Published var error: String?
    @Published var currentUser: MeResponse?
    @Published var serverURL: String = ""

    private let auth = AuthService.shared
    private let api = APIClient.shared
    private let keychain = KeychainService.shared

    init() {
        serverURL = keychain.load(.serverURL) ?? "http://YOUR_SERVER_IP:3000"
    }

    // MARK: - Server Configuration

    func setServerURL(_ urlString: String) {
        let trimmed = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard let url = URL(string: trimmed) else {
            error = "Invalid server URL"
            return
        }
        api.baseURL = url
        serverURL = trimmed
    }

    // MARK: - Login

    func login(email: String, password: String) async {
        error = nil
        isLoading = true
        defer { isLoading = false }

        do {
            setServerURL(serverURL)
            let user = try await auth.login(email: email, password: password)
            currentUser = user
            isAuthenticated = true
        } catch let err as APIError {
            error = err.localizedDescription
        } catch let err as AuthError {
            error = err.localizedDescription
        } catch {
            error = "Connection failed: \(error.localizedDescription)"
        }
    }

    // MARK: - Session Restore

    func checkSession() async {
        isLoading = true
        defer { isLoading = false }

        // Restore saved server URL
        if let saved = keychain.load(.serverURL), let url = URL(string: saved) {
            api.baseURL = url
            serverURL = saved
        }

        guard auth.hasSavedSession else {
            isAuthenticated = false
            return
        }

        if let user = await auth.checkSession() {
            currentUser = user
            isAuthenticated = true
        } else {
            isAuthenticated = false
        }
    }

    // MARK: - Logout

    func logout() async {
        await auth.logout()
        isAuthenticated = false
        currentUser = nil
        error = nil
    }
}
