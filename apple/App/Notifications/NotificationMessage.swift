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
                if !compact {
                    NotificationTimestamp(date: item.createdAt)
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            if !item.body.isEmpty {
                Text(item.body).font(.subheadline).foregroundStyle(.secondary)
                    .lineLimit(compact && !typeSize.isAccessibilitySize ? 2 : nil)
            }
        }
        .foregroundStyle(.primary)
        .multilineTextAlignment(.leading)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }
}

/// Update once a minute and show only the largest completed unit of age.
struct NotificationTimestamp: View {
    let date: Date

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            Text(NotificationAge.formatted(from: date, to: context.date))
                .lineLimit(1).fixedSize()
                .accessibilityLabel(NotificationAge.formatted(from: date, to: context.date, unitsStyle: .full))
        }
    }
}

enum NotificationAge {
    static func components(from date: Date, to now: Date, calendar: Calendar = .current) -> DateComponents {
        guard now > date else { return DateComponents() }
        let units: [Calendar.Component] = [.year, .month, .weekOfMonth, .day, .hour, .minute]
        let elapsed = calendar.dateComponents(Set(units), from: date, to: now)
        var result = DateComponents()
        if let unit = units.first(where: { (elapsed.value(for: $0) ?? 0) > 0 }) {
            result.setValue(elapsed.value(for: unit), for: unit)
        }
        return result
    }

    static func formatted(
        from date: Date, to now: Date,
        unitsStyle: DateComponentsFormatter.UnitsStyle = .abbreviated
    ) -> String {
        let age = components(from: date, to: now)
        guard age != DateComponents() else { return String(localized: "Now") }
        let formatter = DateComponentsFormatter()
        formatter.allowedUnits = [.year, .month, .weekOfMonth, .day, .hour, .minute]
        formatter.unitsStyle = unitsStyle
        formatter.maximumUnitCount = 1
        return formatter.string(from: age) ?? String(localized: "Now")
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
