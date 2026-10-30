import Foundation

/// Explicit temporary gap until WWW-26 supplies the native alarm/widget target.
/// The Expo coordinator mirrors ActivityKit; it does not schedule AlarmKit alarms.
/// Never acknowledge a snapshot as scheduled when no native delivery exists.
@MainActor
final class PanelAlarms {
    static let unavailableMessage = "Native alarm sync is unavailable in Panel until WWW-26. The snapshot was stored locally; no native alarm or Live Activity was scheduled."
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    func configure(serverURL: URL, token: String, cfID: String, cfSecret: String) {
        // Deliberate no-op. Do not persist transport credentials until there is
        // a native consumer. Keep this seam for the future coordinator port.
    }

    func refresh() {
        // Foreground hook retained; there is no native delivery to refresh yet.
    }

    func sync(next: JSONValue) throws {
        let snapshot = JSONValue.object(["next": next])
        defaults.set(try JSONEncoder().encode(snapshot), forKey: "panel.pendingAlarmSnapshot")
    }
}
