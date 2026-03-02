import Foundation

/// Manages knowledge base entries.
@MainActor
final class KnowledgeViewModel: ObservableObject {
    @Published var entries: [KnowledgeEntry] = []
    @Published var isLoading = false
    @Published var error: String?
    @Published var searchText = ""

    private let api = APIClient.shared

    var filteredEntries: [KnowledgeEntry] {
        guard !searchText.isEmpty else { return entries }
        let q = searchText.lowercased()
        return entries.filter {
            $0.entity.lowercased().contains(q) ||
            $0.attribute.lowercased().contains(q) ||
            $0.value.lowercased().contains(q)
        }
    }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            entries = try await api.get("api/knowledge")
        } catch {
            self.error = error.localizedDescription
        }
    }

    func create(entity: String, attribute: String, value: String, sourceContext: String?) async -> Bool {
        do {
            let body = KnowledgeCreateRequest(
                entity: entity, attribute: attribute,
                value: value, source_context: sourceContext
            )
            let entry: KnowledgeEntry = try await api.post("api/knowledge", body: body)
            entries.insert(entry, at: 0)
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    func delete(_ entry: KnowledgeEntry) async {
        do {
            struct DeleteBody: Codable { let id: Int }
            try await api.delete("api/knowledge", body: DeleteBody(id: entry.id))
            entries.removeAll { $0.id == entry.id }
        } catch {
            self.error = error.localizedDescription
        }
    }
}
