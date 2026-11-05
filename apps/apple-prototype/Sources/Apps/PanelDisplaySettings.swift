import SwiftUI

/// Device-local preferences shared by the shell and the native Settings form.
struct PanelDisplayPreferences: DynamicProperty {
    @AppStorage("panel.idleDimming") var idleDimming = true
    @AppStorage("panel.dimBrightness") var dimBrightness = 0.3
    @AppStorage("panel.wakeBrightness") var wakeBrightness = 1.0
    @AppStorage("panel.dimAfterSeconds") var dimAfterSeconds = 60
    @AppStorage("panel.returnToClockSeconds") var returnToClockSeconds = 60

    func brightness(dimmed: Bool) -> Double {
        let awake = min(1, max(0.1, wakeBrightness))
        return dimmed ? min(awake, max(0.1, dimBrightness)) : awake
    }
}

struct PanelDisplaySettings: View {
    private var display = PanelDisplayPreferences()

    var body: some View {
        Section("Brightness") {
            brightnessSlider("Wake brightness", value: display.$wakeBrightness)
            Toggle("Dim when idle", isOn: display.$idleDimming)
            if display.idleDimming {
                brightnessSlider("Dim brightness", value: display.$dimBrightness)
                PanelDurationSlider(title: "Dim after", seconds: display.$dimAfterSeconds)
                    .accessibilityIdentifier("display-dim-timeout")
            }
        }
        Section("Return to clock") {
            PanelDurationSlider(title: "After inactivity", seconds: display.$returnToClockSeconds, allowsNever: true)
                .accessibilityIdentifier("display-clock-timeout")
            Text("Active walks and timers keep the screen awake.").foregroundStyle(.secondary)
        }
        .onChange(of: display.wakeBrightness) { _, value in
            if display.dimBrightness > value { display.dimBrightness = value }
        }
        .onChange(of: display.dimBrightness) { _, value in
            if value > display.wakeBrightness { display.wakeBrightness = value }
        }
    }

    private func brightnessSlider(_ title: String, value: Binding<Double>) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(title)
                Spacer()
                Text(value.wrappedValue, format: .percent.precision(.fractionLength(0)))
                    .foregroundStyle(.secondary).monospacedDigit()
            }
            Slider(value: value, in: 0.1...1, step: 0.05) {
                Text(title)
            } minimumValueLabel: {
                Image(systemName: "sun.min.fill")
            } maximumValueLabel: {
                Image(systemName: "sun.max.fill")
            }
            .accessibilityValue(value.wrappedValue.formatted(.percent.precision(.fractionLength(0))))
        }
        .padding(.vertical, 4)
    }
}

/// The same duration scale is used for dimming and per-app clock behaviour.
struct PanelDurationSlider: View {
    let title: String
    @Binding var seconds: Int
    var allowsNever = false
    private var stops: [Int] { (allowsNever ? [0] : []) + [15, 30, 45, 60, 90, 120, 180, 300, 600, 900, 1800] }
    private var position: Binding<Double> {
        Binding(get: {
            Double(stops.indices.min(by: { abs(stops[$0] - seconds) < abs(stops[$1] - seconds) }) ?? 0)
        }, set: { seconds = stops[Int($0.rounded())] })
    }
    static func label(_ seconds: Int) -> String {
        if seconds == 0 { return "Never" }
        if seconds < 60 { return "\(seconds) sec" }
        if seconds % 60 == 0 { return "\(seconds / 60) min" }
        return "\(seconds / 60) min \(seconds % 60) sec"
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text(title)
                Spacer()
                Text(Self.label(seconds)).monospacedDigit().foregroundStyle(.secondary)
            }
            Slider(value: position, in: 0...Double(stops.count - 1), step: 1) { Text(title) }
                .accessibilityValue(Self.label(seconds))
            HStack {
                Text(Self.label(stops[0])); Spacer(); Text("30 min")
            }.font(.caption).foregroundStyle(.secondary)
        }.padding(.vertical, 8)
    }
}
