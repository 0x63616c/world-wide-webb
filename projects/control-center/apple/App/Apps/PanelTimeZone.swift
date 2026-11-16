import SwiftUI

/// The house time zone chosen in Settings. Clocks, day boundaries and new alarms use it
/// instead of the device zone, which may differ on a wall panel or simulator.
enum PanelTimeZone {
    static let storageKey = "panel.timeZone"
    static let defaultIdentifier = "America/Los_Angeles"

    static func resolve(_ identifier: String?) -> TimeZone {
        identifier.flatMap(TimeZone.init(identifier:)) ?? TimeZone(identifier: defaultIdentifier)!
    }

    static func calendar(for zone: TimeZone) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = zone
        return calendar
    }

    /// Read on hot paths (clock faces every frame), so resolved once and refreshed by `apply`.
    nonisolated(unsafe) private static var cached: TimeZone?
    static var current: TimeZone {
        if let cached { return cached }
        let zone = resolve(UserDefaults.standard.string(forKey: storageKey))
        cached = zone
        return zone
    }
    static var calendar: Calendar { calendar(for: current) }

    /// Foundation defaults (`Date.formatted`, `Calendar.current`, `DateFormatter`) follow the setting too.
    static func apply(_ identifier: String? = UserDefaults.standard.string(forKey: storageKey)) {
        let zone = resolve(identifier)
        cached = zone
        NSTimeZone.default = zone
    }
}

/// Applies the selected zone to the view tree and to Foundation defaults.
struct PanelTimeZoneEnvironment: ViewModifier {
    @AppStorage(PanelTimeZone.storageKey) private var identifier = PanelTimeZone.defaultIdentifier

    func body(content: Content) -> some View {
        let zone = PanelTimeZone.resolve(identifier)
        content
            .environment(\.timeZone, zone)
            .environment(\.calendar, PanelTimeZone.calendar(for: zone))
            .onChange(of: identifier, initial: true) { _, value in PanelTimeZone.apply(value) }
    }
}

struct PanelTimeZoneSettings: View {
    @AppStorage(PanelTimeZone.storageKey) private var identifier = PanelTimeZone.defaultIdentifier

    var body: some View {
        Section {
            NavigationLink {
                PanelTimeZonePicker(selection: $identifier)
            } label: {
                LabeledContent("Time Zone", value: PanelTimeZone.resolve(identifier).identifier)
            }
            .accessibilityIdentifier("settings-time-zone")
        } header: {
            Text("Time")
        } footer: {
            Text("Clocks, calendar days and new alarms use this zone.")
        }
    }
}

private struct PanelTimeZonePicker: View {
    @Binding var selection: String
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        List(TimeZone.knownTimeZoneIdentifiers, id: \.self) { identifier in
            Button {
                selection = identifier
                dismiss()
            } label: {
                HStack {
                    Text(identifier.replacingOccurrences(of: "_", with: " ")).foregroundStyle(.primary)
                    Spacer()
                    if identifier == selection {
                        Image(systemName: "checkmark").foregroundStyle(.tint)
                    }
                }
            }
            .accessibilityAddTraits(identifier == selection ? .isSelected : [])
            .listRowBackground(PanelSettingsStyle.row)
        }
        .scrollContentBackground(.hidden).background(Color.black)
        .navigationTitle("Time Zone")
    }
}
