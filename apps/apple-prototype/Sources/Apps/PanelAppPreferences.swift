import SwiftUI
import PanelKit

/// One persistent namespace per stable app ID, shared by the shell and Settings.
@MainActor @Observable final class PanelAppPreferences {
    struct Options: Codable {
        var reduceMotion = false
        var idleSeconds = -1 // Inherit the panel-wide return-to-clock setting.
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
    func idleSeconds(for id: String?, default seconds: Int) -> Int {
        guard let id, self[id].idleSeconds >= 0 else { return seconds }
        return self[id].idleSeconds
    }
    subscript(id: String) -> Options {
        get { values[id] ?? Options() }
        set { values[id] = newValue }
    }
}

struct PanelPerAppSettings: View {
    let app: PanelAppDefinition
    @Environment(PanelAppPreferences.self) private var preferences
    var body: some View {
        Form {
            Section {
                Toggle("Reduce motion", isOn: Binding(get: { preferences[app.id].reduceMotion }, set: { preferences[app.id].reduceMotion = $0 }))
                Toggle("Use display setting", isOn: Binding(
                    get: { preferences[app.id].idleSeconds < 0 },
                    set: { preferences[app.id].idleSeconds = $0 ? -1 : 60 }))
                if preferences[app.id].idleSeconds >= 0 {
                    PanelDurationSlider(title: "Return to clock", seconds: Binding(
                        get: { preferences[app.id].idleSeconds },
                        set: { preferences[app.id].idleSeconds = $0 }), allowsNever: true)
                }
            }
        }.formStyle(.grouped).navigationTitle(app.name)
    }
}
