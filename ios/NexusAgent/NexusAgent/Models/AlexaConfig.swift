import Foundation

struct AlexaConfig: Codable, Equatable {
    let configured: Bool
    let ubidMain: String             // masked in API response
    let atMain: String               // masked in API response
}

struct AlexaUpdateRequest: Codable {
    let ubidMain: String
    let atMain: String
}
