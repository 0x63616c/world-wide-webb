import PanelKit
import SwiftUI

/// Server-stored wall switch behaviour plus a live log of recent flips for tuning gesture timing.
struct PanelWallSwitchSettings: View {
    let api: WallSwitchesAPI?
    @State private var snapshot: WallSwitchesSnapshot?
    @State private var draft: WallSwitchSettings?
    @State private var error: String?

    var body: some View {
        Form {
            Group {
                if api == nil {
                    Label("Connect to your panel server to change wall switches", systemImage: "wifi.slash")
                        .foregroundStyle(.secondary)
                } else if let binding = Binding($draft), let snapshot {
                    content(binding, snapshot: snapshot)
                } else if let error {
                    Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.secondary)
                } else {
                    ProgressView()
                }
            }.listRowBackground(PanelSettingsStyle.row)
        }
        .formStyle(.grouped).scrollContentBackground(.hidden).background(Color.black)
        .task { await poll() }
        .task(id: draft) { await save() }
    }

    @ViewBuilder
    private func content(_ s: Binding<WallSwitchSettings>, snapshot: WallSwitchesSnapshot) -> some View {
        let modes = [s.wrappedValue.bedroomMode, s.wrappedValue.frontDoorMode]
        Section {
            ForEach(snapshot.switches) { item in
                Picker(selection: item.id == "bedroom" ? s.bedroomMode : s.frontDoorMode) {
                    ForEach(WallSwitchSettings.Mode.allCases, id: \.self) { Text(Self.title($0)).tag($0) }
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.name)
                        Text(
                            item.entity == nil
                                ? "Not connected to Home Assistant" : item.connected ? "Listening" : "Reconnecting"
                        )
                        .font(.caption).foregroundStyle(item.entity != nil && item.connected ? .green : .secondary)
                    }
                }
                .accessibilityIdentifier("wall-switch-mode-\(item.id)")
            }
        } header: {
            Text("Switches")
        } footer: {
            Text(
                """
                Off: Control Center ignores the switch. \
                Room only: a flip toggles the bedroom lamps (the front door Shelly already switches the overheads). \
                Gestures: adds double and triple flips. \
                Smart: adds the alarm, party and night rules below.
                """)
        }
        if let error {
            Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
        }
        if modes.contains(where: { $0 == .gestures || $0 == .smart }) {
            Section {
                slider("Gesture window", value: s.gestureWindowMs, range: 0...2000, step: 50, unit: "ms")
                Picker("Double flip", selection: s.doubleAction) {
                    Text("Nothing").tag(WallSwitchSettings.DoubleAction.none)
                    Text("Toggle everything").tag(WallSwitchSettings.DoubleAction.apartmentToggle)
                    Text("Everything off").tag(WallSwitchSettings.DoubleAction.allOff)
                    Text("Everything on").tag(WallSwitchSettings.DoubleAction.allOn)
                }
                Toggle("Include overheads and cabinet", isOn: s.includeRelays)
                Picker("Triple flip", selection: s.tripleAction) {
                    Text("Nothing").tag(WallSwitchSettings.TripleAction.none)
                    Text("Party mode").tag(WallSwitchSettings.TripleAction.party)
                    Text("White").tag(WallSwitchSettings.TripleAction.white)
                    Text("Red").tag(WallSwitchSettings.TripleAction.red)
                    Text("Blue").tag(WallSwitchSettings.TripleAction.blue)
                    Text("Mood").tag(WallSwitchSettings.TripleAction.mood)
                }
                Toggle("Blink bedroom lamps to confirm", isOn: s.confirmBlink)
            } header: {
                Text("Gestures")
            } footer: {
                Text(
                    """
                    How soon the next flip must follow to count as a double or triple. \
                    Normal flips are never delayed; 0 turns gestures off. \
                    "Toggle everything" turns all lights off if any are on, otherwise on. \
                    The blink is experimental and only works from the bedroom switch.
                    """)
            }
        }
        if modes.contains(.smart) {
            Section {
                Toggle("Flip stops a ringing alarm", isOn: s.smartAlarm)
                Toggle("Flip ends party mode", isOn: s.smartParty)
                Toggle("Dim, warm lamps at night", isOn: s.smartNight)
                if s.wrappedValue.smartNight {
                    timePicker("Night starts", value: s.nightStart)
                    timePicker("Night ends", value: s.nightEnd)
                    slider("Night brightness", value: s.nightBrightness, range: 1...100, step: 1, unit: "%")
                    slider("Night colour", value: s.nightKelvin, range: 2000...6500, step: 100, unit: "K")
                }
            } header: {
                Text("Smart")
            } footer: {
                Text(
                    "A single flip does the first rule that applies instead of toggling the room. Night settings apply when the bedroom lamps turn on."
                )
            }
        }
        Section {
            slider("Bounce filter", value: s.bounceMs, range: 0...500, step: 10, unit: "ms")
        } header: {
            Text("Advanced")
        } footer: {
            Text("Flips closer together than this are treated as switch contact bounce and ignored.")
        }
        Section("Recent Flips") {
            if snapshot.flips.isEmpty {
                Text("No flips yet").foregroundStyle(.secondary)
            }
            ForEach(snapshot.flips) { flip in
                FlipRow(flip: flip, name: snapshot.switches.first { $0.id == flip.switch }?.name ?? flip.switch)
            }
        }
    }

    private func slider(
        _ title: String, value: Binding<Int>, range: ClosedRange<Double>, step: Double, unit: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title)
                Spacer()
                Text("\(value.wrappedValue) \(unit)").foregroundStyle(.secondary).monospacedDigit()
            }
            Slider(
                // Snap in the binding; a Slider `step` draws a tick per step, which is noisy for 0–2000 ms.
                value: Binding(
                    get: { Double(value.wrappedValue) },
                    set: { value.wrappedValue = Int(($0 / step).rounded() * step) }),
                in: range
            ) { Text(title) }
        }
        .padding(.vertical, 4)
    }

    private func timePicker(_ title: String, value: Binding<String>) -> some View {
        let date = Binding<Date>(
            get: {
                let parts = value.wrappedValue.split(separator: ":").compactMap { Int($0) }
                return Calendar.current.date(
                    bySettingHour: parts.first ?? 0, minute: parts.last ?? 0, second: 0, of: .now) ?? .now
            },
            set: {
                let c = Calendar.current.dateComponents([.hour, .minute], from: $0)
                value.wrappedValue = String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
            })
        return DatePicker(title, selection: date, displayedComponents: .hourAndMinute)
    }

    private static func title(_ mode: WallSwitchSettings.Mode) -> String {
        switch mode {
        case .off: "Off"
        case .room: "Room only"
        case .gestures: "Gestures"
        case .smart: "Smart"
        }
    }

    /// Refreshes the flip log every two seconds while visible, so tuning shows results immediately.
    private func poll() async {
        guard let api else { return }
        while !Task.isCancelled {
            do {
                let next = try await api.load()
                snapshot = next
                if draft == nil { draft = next.settings }
                error = nil
            } catch {
                self.error = "Couldn't load wall switches"
            }
            try? await Task.sleep(for: .seconds(2))
        }
    }

    /// Saves shortly after the last change, so dragging a slider sends one request.
    private func save() async {
        guard let api, let draft, let snapshot, draft != snapshot.settings else { return }
        try? await Task.sleep(for: .milliseconds(400))
        guard !Task.isCancelled else { return }
        do {
            self.snapshot = try await api.save(draft)
            error = nil
        } catch {
            self.error = "Couldn't save. Check the values and try again."
        }
    }
}

private struct FlipRow: View {
    let flip: WallSwitchFlip
    let name: String

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(name) · \(flip.gesture.capitalized)")
                Text(flip.action).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(Self.time(flip.at)).monospacedDigit()
                if let gap = flip.gapMs {
                    Text(gap < 60_000 ? "+\(gap) ms" : "+\(gap / 1000) s").font(.caption).foregroundStyle(.secondary)
                        .monospacedDigit()
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private static func time(_ raw: String) -> String {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = parser.date(from: raw) else { return raw }
        return date.formatted(.dateTime.hour().minute().second().secondFraction(.fractional(3)))
    }
}
