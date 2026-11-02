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

struct PanelPerAppSettings: View {
    let app: PanelAppDefinition
    @Environment(PanelAppPreferences.self) private var preferences
    var body: some View {
        Form {
            Section {
                Toggle("Reduce motion", isOn: Binding(get: { preferences[app.id].reduceMotion }, set: { preferences[app.id].reduceMotion = $0 }))
                Picker("Return to clock", selection: Binding(get: { preferences[app.id].idleSeconds }, set: { preferences[app.id].idleSeconds = $0 })) {
                    Text("1 minute").tag(60)
                    Text("2 minutes").tag(120)
                    Text("5 minutes").tag(300)
                    Text("Never").tag(0)
                }
            }
        }.formStyle(.grouped).navigationTitle(app.name)
    }
}
