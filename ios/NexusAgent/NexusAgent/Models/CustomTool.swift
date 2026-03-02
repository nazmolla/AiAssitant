import Foundation

struct CustomTool: Codable, Identifiable, Equatable {
    let name: String                 // e.g. 'custom.tool_name'
    let description: String
    let input_schema: String         // JSON Schema string
    let implementation: String       // JS/TS code
    var enabled: Int                 // 0 | 1
    let created_at: String?

    var id: String { name }

    var isEnabled: Bool {
        get { enabled == 1 }
    }

    var parsedSchema: [String: AnyCodable]? {
        guard let data = input_schema.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode([String: AnyCodable].self, from: data)
    }
}

struct CustomToolCreateRequest: Codable {
    let name: String
    let description: String
    let inputSchema: [String: AnyCodable]
    let implementation: String
}

struct CustomToolToggleRequest: Codable {
    let name: String
    let enabled: Bool
}

struct CustomToolDeleteRequest: Codable {
    let name: String
}
