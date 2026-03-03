import Foundation

struct LLMProvider: Codable, Identifiable, Equatable {
    let id: String
    let label: String
    let provider_type: String        // 'azure-openai' | 'openai' | 'anthropic' | 'litellm'
    let purpose: String              // 'chat' | 'embedding' | 'audio'
    let config: LLMProviderConfig?
    let is_default: Bool
    let created_at: String?
    let has_api_key: Bool?

    static func == (lhs: LLMProvider, rhs: LLMProvider) -> Bool {
        lhs.id == rhs.id
    }
}

struct LLMProviderConfig: Codable {
    // Common
    var apiKey: String?
    var model: String?

    // Azure OpenAI
    var endpoint: String?
    var deployment: String?
    var apiVersion: String?
    var ttsDeployment: String?
    var sttDeployment: String?

    // OpenAI / LiteLLM
    var baseURL: String?

    // Optional extras
    var routingTier: String?
    var capabilities: [String]?
}

struct LLMProviderCreateRequest: Codable {
    let label: String
    let provider_type: String
    let purpose: String
    let config: LLMProviderConfig
    let is_default: Bool?
}

struct LLMProviderUpdateRequest: Codable {
    let id: String
    let label: String?
    let config: LLMProviderConfig?
    let is_default: Bool?
}
