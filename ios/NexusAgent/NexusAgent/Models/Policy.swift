import Foundation

struct ToolPolicy: Codable, Equatable, Identifiable {
    let tool_name: String
    let mcp_id: String?
    var requires_approval: Int       // 0 | 1
    var is_proactive_enabled: Int    // 0 | 1

    var id: String { tool_name }

    var requiresApproval: Bool {
        get { requires_approval == 1 }
        set { requires_approval = newValue ? 1 : 0 }
    }

    var isProactiveEnabled: Bool {
        get { is_proactive_enabled == 1 }
        set { is_proactive_enabled = newValue ? 1 : 0 }
    }
}

struct PolicyCreateRequest: Codable {
    let tool_name: String
    let mcp_id: String?
    let requires_approval: Int?
    let is_proactive_enabled: Int?
}
