import Foundation

struct Channel: Codable, Identifiable, Equatable {
    let id: String
    let channel_type: String         // 'whatsapp' | 'slack' | 'email' | 'telegram' | 'discord' | 'teams'
    let label: String
    var enabled: Int                 // 0 | 1
    let config_json: String?         // encrypted/masked JSON config
    let webhook_secret: String?
    let user_id: String?
    let created_at: String?
    let discord_bot_active: Bool?

    var isEnabled: Bool {
        get { enabled == 1 }
    }

    var channelIcon: String {
        switch channel_type {
        case "whatsapp":  return "message.fill"
        case "slack":     return "number.square.fill"
        case "email":     return "envelope.fill"
        case "telegram":  return "paperplane.fill"
        case "discord":   return "gamecontroller.fill"
        case "teams":     return "person.2.fill"
        default:          return "antenna.radiowaves.left.and.right"
        }
    }

    static func == (lhs: Channel, rhs: Channel) -> Bool {
        lhs.id == rhs.id
    }
}

struct ChannelCreateRequest: Codable {
    let label: String
    let channelType: String
    let config: [String: AnyCodable]
}

struct ChannelUpdateRequest: Codable {
    let id: String
    let label: String?
    let channelType: String?
    let config: [String: AnyCodable]?
    let enabled: Int?
}
