import SwiftUI

/// Displays a single message bubble (user or assistant).
struct MessageBubbleView: View {
    let message: Message
    @State private var showToolCalls = false

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if message.role == "user" {
                Spacer(minLength: 60)
            }

            VStack(alignment: message.role == "user" ? .trailing : .leading, spacing: 6) {
                // Role label
                HStack(spacing: 4) {
                    Image(systemName: roleIcon)
                        .font(.caption2)
                        .foregroundStyle(roleColor)
                    Text(roleLabel)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(roleColor)

                    Spacer()

                    if let date = message.createdDate {
                        Text(date, style: .time)
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }

                // Content
                if let content = message.content, !content.isEmpty {
                    Text(content)
                        .font(.body)
                        .textSelection(.enabled)
                }

                // Tool Calls
                if let toolCalls = message.parsedToolCalls, !toolCalls.isEmpty {
                    DisclosureGroup("Tool Calls (\(toolCalls.count))", isExpanded: $showToolCalls) {
                        ForEach(toolCalls, id: \.name) { tool in
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Image(systemName: "wrench.and.screwdriver")
                                        .font(.caption2)
                                    Text(tool.name)
                                        .font(.caption.monospaced())
                                        .fontWeight(.medium)
                                }
                                .foregroundStyle(.orange)

                                if let args = tool.arguments {
                                    Text(args.prettyPrinted)
                                        .font(.caption2.monospaced())
                                        .foregroundStyle(.secondary)
                                        .lineLimit(5)
                                }
                            }
                            .padding(8)
                            .background(.ultraThinMaterial)
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }

                // Attachments
                if let attachments = message.parsedAttachments, !attachments.isEmpty {
                    HStack(spacing: 6) {
                        Image(systemName: "paperclip")
                            .font(.caption2)
                        ForEach(attachments, id: \.id) { att in
                            Text(att.filename)
                                .font(.caption2)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(.ultraThinMaterial)
                                .clipShape(Capsule())
                        }
                    }
                    .foregroundStyle(.secondary)
                }
            }
            .padding(12)
            .background(bubbleBackground)
            .clipShape(RoundedRectangle(cornerRadius: 16))

            if message.role != "user" {
                Spacer(minLength: 60)
            }
        }
    }

    // MARK: - Helpers

    private var roleIcon: String {
        switch message.role {
        case "user":      return "person.fill"
        case "assistant": return "brain.head.profile"
        case "system":    return "gear"
        case "tool":      return "wrench.and.screwdriver"
        default:          return "questionmark.circle"
        }
    }

    private var roleLabel: String {
        switch message.role {
        case "user":      return "You"
        case "assistant": return "Nexus"
        case "system":    return "System"
        case "tool":      return "Tool"
        default:          return message.role
        }
    }

    private var roleColor: Color {
        switch message.role {
        case "user":      return .blue
        case "assistant": return .green
        case "system":    return .gray
        case "tool":      return .orange
        default:          return .primary
        }
    }

    private var bubbleBackground: some ShapeStyle {
        switch message.role {
        case "user":      return AnyShapeStyle(Color.accentColor.opacity(0.15))
        case "assistant": return AnyShapeStyle(Color(.systemGray6))
        default:          return AnyShapeStyle(Color(.systemGray5))
        }
    }
}
