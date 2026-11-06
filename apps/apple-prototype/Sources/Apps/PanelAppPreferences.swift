import SwiftUI
import PanelKit

/// One persistent namespace per stable app ID, shared by the shell and Settings.
@MainActor @Observable final class PanelAppPreferences {
    struct Options: Codable {
        var reduceMotion = false
        var idleSeconds = 60
    }
    private let defaults: UserDefaults
    private var values: [String: Options] {
        didSet { if let data = try? JSONEncoder().encode(values) { defaults.set(data, forKey: "panel.appPreferences") } }
    }
    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        values = defaults.data(forKey: "panel.appPreferences")
            .flatMap { try? JSONDecoder().decode([String: Options].self, from: $0) } ?? [:]
    }
    subscript(id: String) -> Options {
        get { values[id] ?? Options() }
        set { values[id] = newValue }
    }
}
