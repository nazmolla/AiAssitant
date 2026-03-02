import Foundation

struct UserProfile: Codable, Equatable {
    var user_id: String?
    var display_name: String
    var title: String
    var bio: String
    var location: String
    var phone: String
    var email: String
    var website: String
    var linkedin: String
    var github: String
    var twitter: String
    var skills: String               // JSON array string
    var languages: String            // JSON array string
    var company: String
    var screen_sharing_enabled: Int
    var notification_level: String   // 'low' | 'medium' | 'high' | 'disaster'
    var theme: String                // 'ember' | 'ocean' | etc.
    var font: String                 // 'inter' | etc.
    var timezone: String
    var updated_at: String?

    var parsedSkills: [String] {
        get {
            guard let data = skills.data(using: .utf8) else { return [] }
            return (try? JSONDecoder().decode([String].self, from: data)) ?? []
        }
        set {
            if let data = try? JSONEncoder().encode(newValue),
               let str = String(data: data, encoding: .utf8) {
                skills = str
            }
        }
    }

    var parsedLanguages: [String] {
        get {
            guard let data = languages.data(using: .utf8) else { return [] }
            return (try? JSONDecoder().decode([String].self, from: data)) ?? []
        }
        set {
            if let data = try? JSONEncoder().encode(newValue),
               let str = String(data: data, encoding: .utf8) {
                languages = str
            }
        }
    }

    static let empty = UserProfile(
        user_id: nil, display_name: "", title: "", bio: "", location: "",
        phone: "", email: "", website: "", linkedin: "", github: "",
        twitter: "", skills: "[]", languages: "[]", company: "",
        screen_sharing_enabled: 1, notification_level: "disaster",
        theme: "ember", font: "inter", timezone: "", updated_at: nil
    )
}
