import SwiftUI

/// One familiar card layout in banners and history: icon, title, age, two body lines.
struct NotificationCardContent: View {
    let item: NotificationItem
    let source: NotificationSource
    @Environment(\.dynamicTypeSize) private var typeSize
    private var style: String {
        #if DEBUG
            UserDefaults.standard.string(forKey: "previewNotificationStyle") ?? "classic"
        #else
            "classic"
        #endif
    }

    var body: some View {
        HStack(alignment: .top, spacing: style == "airy" ? 18 : 12) {
            NotificationSourceIcon(source: source, side: style == "airy" ? 48 : 38)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(style == "compact" ? source.name : item.title)
                        .font(style == "compact" ? .caption.weight(.semibold) : .headline)
                        .accessibilityLabel(style == "compact" ? source.name : "\(source.name), \(item.title)")
                        .lineLimit(typeSize.isAccessibilitySize ? nil : 1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    NotificationTimestamp(date: item.createdAt)
                        .font(.caption).foregroundStyle(.secondary)
                }
                if style == "compact" {
                    Text(item.title).font(.headline).lineLimit(typeSize.isAccessibilitySize ? nil : 1)
                }
                if !item.body.isEmpty {
                    Text(item.body).font(.subheadline)
                        .lineLimit(typeSize.isAccessibilitySize ? nil : 2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .padding(style == "airy" ? 20 : 16)
        .foregroundStyle(.primary).multilineTextAlignment(.leading)
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
        if unitsStyle == .full {
            let formatter = DateComponentsFormatter()
            formatter.allowedUnits = [.year, .month, .weekOfMonth, .day, .hour, .minute]
            formatter.unitsStyle = .full
            formatter.maximumUnitCount = 1
            return (formatter.string(from: age) ?? "") + String(localized: " ago")
        }
        for (unit, suffix) in [
            (Calendar.Component.year, "y"), (.month, "mo"), (.weekOfMonth, "w"),
            (.day, "d"), (.hour, "h"), (.minute, "m"),
        ] {
            if let value = age.value(for: unit), value > 0 { return "\(value)\(suffix) ago" }
        }
        return String(localized: "Now")
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
