import Foundation

/// Manages user profile data.
@MainActor
final class ProfileViewModel: ObservableObject {
    @Published var profile: UserProfile = .empty
    @Published var isLoading = false
    @Published var isSaving = false
    @Published var error: String?
    @Published var successMessage: String?

    // Password change
    @Published var currentPassword = ""
    @Published var newPassword = ""
    @Published var confirmPassword = ""

    private let api = APIClient.shared

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            profile = try await api.get("api/config/profile")
        } catch {
            self.error = error.localizedDescription
        }
    }

    func save() async -> Bool {
        isSaving = true
        defer { isSaving = false }
        error = nil
        successMessage = nil

        do {
            try await api.put("api/config/profile", body: profile) as Void
            successMessage = "Profile saved"
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func changePassword() async -> Bool {
        guard newPassword == confirmPassword else {
            error = "Passwords don't match"
            return false
        }
        guard newPassword.count >= 8 else {
            error = "Password must be at least 8 characters"
            return false
        }

        error = nil
        successMessage = nil

        do {
            try await AuthService.shared.changePassword(
                currentPassword: currentPassword,
                newPassword: newPassword
            )
            currentPassword = ""
            newPassword = ""
            confirmPassword = ""
            successMessage = "Password changed successfully"
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }
}
