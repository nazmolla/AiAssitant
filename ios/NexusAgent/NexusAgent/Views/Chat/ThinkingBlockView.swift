import SwiftUI

/// Animated "thinking" indicator shown during SSE streaming.
struct ThinkingBlockView: View {
    let status: String

    @State private var dotCount = 0
    private let timer = Timer.publish(every: 0.4, on: .main, in: .common).autoconnect()

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: "brain.head.profile")
                        .font(.caption2)
                        .foregroundStyle(.green)

                    Text("Nexus")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.green)
                }

                HStack(spacing: 6) {
                    ProgressView()
                        .scaleEffect(0.7)

                    Text(status + dots)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .italic()
                }
            }
            .padding(12)
            .background(Color(.systemGray6))
            .clipShape(RoundedRectangle(cornerRadius: 16))

            Spacer(minLength: 60)
        }
        .onReceive(timer) { _ in
            dotCount = (dotCount + 1) % 4
        }
    }

    private var dots: String {
        String(repeating: ".", count: dotCount)
    }
}

/// Block that displays tool execution thoughts/steps in a collapsible section.
struct ThoughtsBlockView: View {
    let thoughts: [String]
    @State private var isExpanded = false

    var body: some View {
        if !thoughts.isEmpty {
            DisclosureGroup(isExpanded: $isExpanded) {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(thoughts.enumerated()), id: \.offset) { _, thought in
                        HStack(alignment: .top, spacing: 6) {
                            Image(systemName: "chevron.right")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .padding(.top, 2)
                            Text(thought)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "lightbulb.fill")
                        .font(.caption2)
                        .foregroundStyle(.yellow)
                    Text("Reasoning Steps (\(thoughts.count))")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                }
            }
            .padding(10)
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 10))
        }
    }
}
