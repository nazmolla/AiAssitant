import Foundation
import Network

/// Discovers Nexus Agent servers on the local network by probing common addresses.
/// Tries the saved/default URL first, then scans 192.168.x.x subnets on port 3000.
final class ServerDiscovery: ObservableObject {
    enum State: Equatable {
        case idle
        case scanning(progress: Double, detail: String)
        case found(url: String)
        case failed
    }

    @Published var state: State = .idle
    @Published var discoveredServers: [String] = []

    private var isCancelled = false

    /// Common subnet prefixes to scan, ordered by likelihood.
    private let subnets = ["192.168.0", "192.168.1", "192.168.2", "192.168.10", "10.0.0", "10.0.1"]
    /// Common ports the server might run on.
    private let ports = [3000, 80, 8080, 443]

    /// Start discovery. Tries saved URL first, then scans local network.
    @MainActor
    func discover(savedURL: String?) async {
        isCancelled = false
        discoveredServers = []
        state = .scanning(progress: 0, detail: "Checking saved server...")

        // 1. Try saved/default URL first
        if let saved = savedURL, !saved.isEmpty {
            if await probe(saved) {
                discoveredServers.append(saved)
                state = .found(url: saved)
                return
            }
        }

        // 2. Try the well-known default
        let defaultURL = "http://YOUR_SERVER_IP:3000"
        if savedURL != defaultURL {
            state = .scanning(progress: 0.05, detail: "Trying default address...")
            if await probe(defaultURL) {
                discoveredServers.append(defaultURL)
                state = .found(url: defaultURL)
                return
            }
        }

        // 3. Scan common subnets
        let totalProbes = subnets.count * 254
        var probed = 0

        for subnet in subnets {
            if isCancelled { break }

            // Scan hosts 1-254 in batches for speed
            let batchSize = 20
            for batchStart in stride(from: 1, through: 254, by: batchSize) {
                if isCancelled { break }

                let batchEnd = min(batchStart + batchSize - 1, 254)
                let batch = (batchStart...batchEnd).map { "\(subnet).\($0)" }

                await withTaskGroup(of: String?.self) { group in
                    for ip in batch {
                        for port in ports {
                            group.addTask {
                                let url = "http://\(ip):\(port)"
                                if await self.probe(url) {
                                    return url
                                }
                                return nil
                            }
                        }
                    }

                    for await result in group {
                        if let url = result {
                            await MainActor.run {
                                if !discoveredServers.contains(url) {
                                    discoveredServers.append(url)
                                }
                            }
                        }
                    }
                }

                probed += batch.count
                let progress = Double(probed) / Double(totalProbes)
                state = .scanning(progress: progress, detail: "Scanning \(subnet).x...")

                // If we found one, stop early
                if !discoveredServers.isEmpty {
                    state = .found(url: discoveredServers[0])
                    return
                }
            }
        }

        state = discoveredServers.isEmpty ? .failed : .found(url: discoveredServers[0])
    }

    /// Cancel ongoing scan.
    func cancel() {
        isCancelled = true
    }

    /// Probe a URL to check if it's a Nexus Agent server.
    /// Hits /api/auth/csrf which returns a CSRF token on any valid NextAuth server.
    private func probe(_ baseURL: String) async -> Bool {
        guard let url = URL(string: "\(baseURL)/api/auth/csrf") else { return false }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 2.0 // Fast timeout for scanning

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                return false
            }
            // Verify it returns a csrfToken (confirms it's a NextAuth server)
            if let json = try? JSONDecoder().decode([String: String].self, from: data),
               json["csrfToken"] != nil {
                return true
            }
            return false
        } catch {
            return false
        }
    }
}
