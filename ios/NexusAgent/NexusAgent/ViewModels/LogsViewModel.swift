import Foundation

/// Manages agent logs viewing and deletion.
@MainActor
final class LogsViewModel: ObservableObject {
    @Published var logs: [AgentLog] = []
    @Published var isLoading = false
    @Published var error: String?

    // Filters
    @Published var levelFilter: String = ""
    @Published var sourceFilter: String = ""
    @Published var limit: Int = 100

    private let api = APIClient.shared

    func load() async {
        isLoading = true
        defer { isLoading = false }
        error = nil

        do {
            var queryItems = [URLQueryItem(name: "limit", value: "\(limit)")]
            if !levelFilter.isEmpty {
                queryItems.append(URLQueryItem(name: "level", value: levelFilter))
            }
            if !sourceFilter.isEmpty {
                queryItems.append(URLQueryItem(name: "source", value: sourceFilter))
            }
            logs = try await api.get("api/logs", queryItems: queryItems)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func clearAll() async {
        do {
            let body = LogDeleteRequest(mode: "all", level: nil, days: nil)
            try await api.delete("api/logs", body: body)
            logs = []
        } catch {
            self.error = error.localizedDescription
        }
    }

    func clearByLevel(_ level: String) async {
        do {
            let body = LogDeleteRequest(mode: "level", level: level, days: nil)
            try await api.delete("api/logs", body: body)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }

    func clearOlderThan(days: Int) async {
        do {
            let body = LogDeleteRequest(mode: "older-than-days", level: nil, days: days)
            try await api.delete("api/logs", body: body)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
