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
        Section("Return to Clock") {
            let seconds = Binding<Double>(
                get: { Double(display.returnToClockSeconds) },
                set: { display.returnToClockSeconds = Int($0) }
            )
            LabeledContent("After inactivity", value: Duration.seconds(display.returnToClockSeconds).formatted(.units(allowed: [.minutes, .seconds])))
            Slider(value: seconds, in: 30...600, step: 30) {
                Text("Return to clock after")
            }.accessibilityIdentifier("display-return-timeout")
        }
        Section("Brightness") {
            brightnessSlider("Wake brightness", value: display.$wakeBrightness)
            Toggle("Dim when idle", isOn: display.$idleDimming)
            if display.idleDimming {
                brightnessSlider("Dim brightness", value: display.$dimBrightness)
                Picker("Dim after", selection: display.$dimAfterSeconds) {
                    Text("30 seconds").tag(30)
                    Text("1 minute").tag(60)
                    Text("2 minutes").tag(120)
                    Text("5 minutes").tag(300)
                    Text("10 minutes").tag(600)
                }
                .accessibilityIdentifier("display-dim-timeout")
            }
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
