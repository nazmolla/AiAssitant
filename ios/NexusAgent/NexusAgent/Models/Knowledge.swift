import Foundation

struct KnowledgeEntry: Codable, Identifiable, Equatable {
    let id: Int
    let user_id: String?
    let entity: String
    let attribute: String
    let value: String
    let source_context: String?
    let last_updated: String?
}

struct KnowledgeCreateRequest: Codable {
    let entity: String
    let attribute: String
    let value: String
    let source_context: String?
}
