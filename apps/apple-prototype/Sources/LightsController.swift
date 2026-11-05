import SwiftUI

struct ControlsController: View {
    let store: any HomeDataSource
    var fanIsOn: Bool? = nil
    @State private var previewBrightness: Int?
    var body: some View {
        Form {
            Section {
                Button { store.send(.toggle(.all)) } label: {
                    Label(store.lamps.isOn(.all) ? "Turn all off" : "Turn all on", systemImage: "power")
                }.accessibilityIdentifier("lights-all-power")
                ForEach([Accessory.bedroom, .livingRoom, .ceiling, .cabinet]) { key in
                    Button { store.send(.toggle(key)) } label: {
                        LabeledContent {
                            Text(store.lamps.isOn(key) ? "On" : "Off").foregroundStyle(.secondary)
                        } label: {
                            Label(key.name, systemImage: key.symbol)
                                .foregroundStyle(store.lamps.isOn(key) ? .orange : .primary)
                        }.frame(minHeight: 44).contentShape(.rect)
                    }.buttonStyle(.plain)
                        .accessibilityLabel("Toggle \(key.name)")
                        .accessibilityIdentifier("controller-toggle-\(key.rawValue)")
                        .accessibilityValue(store.lamps.isOn(key) ? "On" : "Off")
                }
            } header: { Text("Rooms & fixtures") }
            Section {
                LabeledContent("Brightness") {
                    Text("\(previewBrightness ?? store.lamps.brightness)%").monospacedDigit()
                        .accessibilityIdentifier("lamp-brightness-value")
                }
                FilledLevelControl(value: store.lamps.brightness, label: "Lamp brightness", symbol: "sun.max.fill",
                    preview: { previewBrightness = $0 }) { store.send(.brightness($0)) }
                    .frame(height: 72).disabled(!store.lamps.anyOn).accessibilityIdentifier("lamp-brightness")
            } header: { Text("All lamps") }
            Section("Colour & warmth") { LampEffectsView(store: store).padding(.vertical, 8) }
        }.formStyle(.grouped).navigationTitle("Lights")
    }
}
