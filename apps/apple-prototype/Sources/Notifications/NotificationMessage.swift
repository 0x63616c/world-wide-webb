import SwiftUI

/// Shared hierarchy for the inbox and incoming banners. Color only communicates
/// unread/urgent state; source identity lives in the existing app artwork.
struct NotificationMessage: View {
    @Environment(\.dynamicTypeSize) private var typeSize
    let item: NotificationItem
    var compact = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if item.priority == .critical {
                    Image(systemName: "exclamationmark.circle.fill")
                        .foregroundStyle(.red)
                        .accessibilityLabel("Critical")
                } else if item.readAt == nil {
                    Circle().fill(.tint).frame(width: 6, height: 6)
                        .accessibilityLabel("Unread")
                }
                Text(item.title).font(.headline)
                    .lineLimit(compact && !typeSize.isAccessibilitySize ? 2 : nil)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            if !item.body.isEmpty {
                Text(item.body).font(.subheadline).foregroundStyle(.secondary)
                    .lineLimit(compact && !typeSize.isAccessibilitySize ? 2 : nil)
            }
            if !compact {
                Text(item.createdAt, style: .relative)
                    .font(.caption).foregroundStyle(.secondary).padding(.top, 2)
            }
        }
        .foregroundStyle(.primary)
        .multilineTextAlignment(.leading)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }
}

/// Icon-only visually, fully named for VoiceOver, pointer help and Voice Control.
/// Used within a glass surface, so it doesn't add a second refracting layer.
struct NotificationIconButton: View {
    let label: String
    let symbol: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.secondary)
                .frame(width: 44, height: 44)
                .background(.quaternary, in: .circle)
                .contentShape(.circle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .help(label)
    }
}
