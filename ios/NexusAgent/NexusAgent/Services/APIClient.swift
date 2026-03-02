import Foundation

/// Central HTTP client for all Nexus Agent API requests.
/// Uses URLSession with persistent cookie storage for NextAuth session management.
final class APIClient {
    static let shared = APIClient()

    /// The base URL of the Nexus Agent server (e.g. "http://YOUR_SERVER_IP:3000")
    var baseURL: URL {
        get {
            if let cached = _baseURL { return cached }
            if let saved = KeychainService.shared.load(.serverURL),
               let url = URL(string: saved) {
                _baseURL = url
                return url
            }
            // Default local
            return URL(string: "http://localhost:3000")!
        }
        set {
            _baseURL = newValue
            KeychainService.shared.save(newValue.absoluteString, for: .serverURL)
        }
    }
    private var _baseURL: URL?

    /// Shared URLSession with cookie storage
    let session: URLSession

    private init() {
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = HTTPCookieStorage.shared
        config.httpCookieAcceptPolicy = .always
        config.httpShouldSetCookies = true
        config.timeoutIntervalForRequest = 30
        config.timeoutIntervalForResource = 120
        session = URLSession(configuration: config)
    }

    // MARK: - Generic Request Helpers

    /// Perform a GET request and decode the JSON response.
    func get<T: Decodable>(_ path: String, queryItems: [URLQueryItem]? = nil) async throws -> T {
        var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false)!
        components.queryItems = queryItems
        guard let url = components.url else { throw APIError.invalidURL }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await session.data(for: request)
        try validateResponse(response, data: data)
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// Perform a POST request with a JSON body and decode the response.
    func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        let request = try jsonRequest("POST", path: path, body: body)
        let (data, response) = try await session.data(for: request)
        try validateResponse(response, data: data)
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// POST with no decoded response (returns raw Data).
    func post<B: Encodable>(_ path: String, body: B) async throws {
        let request = try jsonRequest("POST", path: path, body: body)
        let (data, response) = try await session.data(for: request)
        try validateResponse(response, data: data)
    }

    /// Perform a PUT request.
    func put<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        let request = try jsonRequest("PUT", path: path, body: body)
        let (data, response) = try await session.data(for: request)
        try validateResponse(response, data: data)
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// PUT with no decoded response.
    func put<B: Encodable>(_ path: String, body: B) async throws {
        let request = try jsonRequest("PUT", path: path, body: body)
        let (data, response) = try await session.data(for: request)
        try validateResponse(response, data: data)
    }

    /// Perform a PATCH request.
    func patch<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        let request = try jsonRequest("PATCH", path: path, body: body)
        let (data, response) = try await session.data(for: request)
        try validateResponse(response, data: data)
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// PATCH with no decoded response.
    func patch<B: Encodable>(_ path: String, body: B) async throws {
        let request = try jsonRequest("PATCH", path: path, body: body)
        let (data, response) = try await session.data(for: request)
        try validateResponse(response, data: data)
    }

    /// Perform a DELETE request with a JSON body.
    func delete<B: Encodable>(_ path: String, body: B) async throws {
        let request = try jsonRequest("DELETE", path: path, body: body)
        let (data, response) = try await session.data(for: request)
        try validateResponse(response, data: data)
    }

    /// DELETE with no body (query-based or path-based)
    func delete(_ path: String) async throws {
        let url = baseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await session.data(for: request)
        try validateResponse(response, data: data)
    }

    // MARK: - Multipart Upload

    /// Upload a file using multipart/form-data.
    func upload(_ path: String, fileData: Data, filename: String, mimeType: String, additionalFields: [String: String] = [:]) async throws -> [String: AnyCodable] {
        let url = baseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"

        let boundary = UUID().uuidString
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        // Add text fields
        for (key, value) in additionalFields {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(key)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(value)\r\n".data(using: .utf8)!)
        }
        // Add file
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(fileData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)

        request.httpBody = body

        let (data, response) = try await session.data(for: request)
        try validateResponse(response, data: data)
        return try JSONDecoder().decode([String: AnyCodable].self, from: data)
    }

    // MARK: - SSE Streaming

    /// Create a URLRequest for SSE streaming (used by SSEClient).
    func sseRequest(_ path: String, body: Data) -> URLRequest {
        let url = baseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.httpBody = body
        request.timeoutInterval = 300
        return request
    }

    // MARK: - Internal

    private func jsonRequest<B: Encodable>(_ method: String, path: String, body: B) throws -> URLRequest {
        let url = baseURL.appendingPathComponent(path)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.httpBody = try JSONEncoder().encode(body)
        return request
    }

    private func validateResponse(_ response: URLResponse, data: Data) throws {
        guard let http = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        switch http.statusCode {
        case 200...299:
            return
        case 401:
            throw APIError.unauthorized
        case 403:
            throw APIError.forbidden
        case 404:
            throw APIError.notFound
        case 422:
            let message = parseErrorMessage(data) ?? "Validation error"
            throw APIError.validation(message)
        default:
            let message = parseErrorMessage(data) ?? "Server error (\(http.statusCode))"
            throw APIError.server(http.statusCode, message)
        }
    }

    private func parseErrorMessage(_ data: Data) -> String? {
        if let json = try? JSONDecoder().decode([String: AnyCodable].self, from: data),
           let error = json["error"]?.value as? String {
            return error
        }
        return String(data: data, encoding: .utf8)
    }
}

// MARK: - Error Types

enum APIError: LocalizedError {
    case invalidURL
    case invalidResponse
    case unauthorized
    case forbidden
    case notFound
    case validation(String)
    case server(Int, String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:            return "Invalid URL"
        case .invalidResponse:       return "Invalid response from server"
        case .unauthorized:          return "Session expired. Please log in again."
        case .forbidden:             return "You don't have permission for this action."
        case .notFound:              return "Resource not found"
        case .validation(let msg):   return msg
        case .server(let code, let msg): return "Error \(code): \(msg)"
        }
    }
}
