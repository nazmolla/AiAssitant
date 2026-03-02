import Foundation

struct MCPServer: Codable, Identifiable, Equatable {
    let id: String
    let name: String
    let transport_type: String?      // 'stdio' | 'sse' | 'streamable-http'
    let command: String?
    let args: String?                // JSON array
    let env_vars: String?            // JSON object
    let url: String?
    let auth_type: String?           // 'none' | 'bearer' | 'oauth'
    let access_token: String?        // masked
    let client_id: String?
    let client_secret: String?       // masked
    let user_id: String?
    let scope: String?               // 'global' | 'user'
    let connected: Bool?

    var parsedArgs: [String]? {
        guard let data = args?.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode([String].self, from: data)
    }

    var parsedEnvVars: [String: String]? {
        guard let data = env_vars?.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode([String: String].self, from: data)
    }

    var transportIcon: String {
        switch transport_type {
        case "stdio":            return "terminal.fill"
        case "sse":              return "antenna.radiowaves.left.and.right"
        case "streamable-http":  return "globe"
        default:                 return "questionmark.circle"
        }
    }

    static func == (lhs: MCPServer, rhs: MCPServer) -> Bool {
        lhs.id == rhs.id
    }
}

struct MCPServerCreateRequest: Codable {
    let name: String
    let transport_type: String
    let command: String?
    let args: [String]?
    let env_vars: [String: String]?
    let url: String?
    let auth_type: String?
    let access_token: String?
    let client_id: String?
    let client_secret: String?
    let scope: String?
}

struct MCPServerDeleteRequest: Codable {
    let id: String
}
