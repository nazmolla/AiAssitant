import Foundation

/// Manages tool approval requests.
@MainActor
final class ApprovalsViewModel: ObservableObject {
    @Published var approvals: [ApprovalRequest] = []
    @Published var isLoading = false
    @Published var error: String?

    private let api = APIClient.shared

    var pendingCount: Int {
        approvals.filter { $0.status == "pending" }.count
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            approvals = try await api.get("api/approvals")
        } catch {
            self.error = error.localizedDescription
        }
    }

    func approve(_ approval: ApprovalRequest) async {
        await respond(to: approval, action: "approved")
    }

    func reject(_ approval: ApprovalRequest) async {
        await respond(to: approval, action: "rejected")
    }

    private func respond(to approval: ApprovalRequest, action: String) {
        Task {
            do {
                let body = ApprovalAction(approvalId: approval.id, action: action)
                try await api.post("api/approvals", body: body) as Void
                // Remove from list or update status
                if let idx = approvals.firstIndex(where: { $0.id == approval.id }) {
                    approvals.remove(at: idx)
                }
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
