import Foundation

/// Manages admin user operations (admin-only).
@MainActor
final class AdminViewModel: ObservableObject {
    @Published var users: [User] = []
    @Published var isLoading = false
    @Published var error: String?

    private let api = APIClient.shared

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            users = try await api.get("api/admin/users")
        } catch {
            self.error = error.localizedDescription
        }
    }

    func updateUser(id: String, role: String? = nil, enabled: Int? = nil, permissions: UserPermissions? = nil) async -> Bool {
        do {
            let body = UserUpdateRequest(id: id, role: role, enabled: enabled, permissions: permissions)
            try await api.put("api/admin/users", body: body) as Void
            await load() // Refresh list
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func deleteUser(_ id: String) async {
        do {
            struct Body: Codable { let id: String }
            try await api.delete("api/admin/users", body: Body(id: id))
            users.removeAll { $0.id == id }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
