import SwiftUI

struct ControllerHost: View {
    let tile: HomeTile
    let store: any HomeDataSource
    var headerVisible = true
    let close: () -> Void
    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                Text(tile.title).font(.system(size: 25, weight: .semibold))
                HStack {
                    CircleButton(symbol: "xmark", label: "Close", action: close).accessibilityIdentifier("close-controller")
                    Spacer()
                    TimelineView(.periodic(from: .now, by: 1)) { _ in Text(fixtureTime(store.now)).font(.system(size: 27, weight: .medium)) }
                }
            }.frame(height: 62).padding(.horizontal, 38).padding(.top, 30).opacity(headerVisible ? 1 : 0)
            ControllerCanvas {
                switch tile {
                case .all, .fan, .lamps, .lights: ControlsController(store: store)
                case .climate: ClimateController(store: store)
                case .wifi: WifiController(wifi: store.wifi)
                case .clock: ClockController(store: store)
                case .weather: WeatherController(weather: store.weather)
                case .hourly: HourlyController(weather: store.weather)
                case .sound: SoundController(store: store)
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
            Text("Fixture data").font(.system(size: 12, weight: .medium)).foregroundStyle(.white.opacity(0.42)).padding(.bottom, 16)
        }
        .foregroundStyle(.white).tint(.white)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("controller-\(tile.id)")
    }
}
struct ClimateController: View {
    let store: any HomeDataSource
    var body: some View {
        VStack(spacing: 22) {
            Spacer(minLength: 20)
            Text(caption).font(.system(size: 31)).foregroundStyle(.white.opacity(0.8))
            if store.climate.mode == .off {
                Text("Off").font(.system(size: 220, weight: .ultraLight)).accessibilityIdentifier("climate-value")
            } else if store.climate.mode == .heatCool {
                HStack(spacing: 50) {
                    rangeValue(value: store.climate.low, label: "Heat to", low: true)
                    Text("–").font(.system(size: 80, weight: .ultraLight)).opacity(0.5)
                    rangeValue(value: store.climate.high, label: "Cool to", low: false)
                }
            } else {
                HStack(spacing: 85) {
                    CircleButton(symbol: "chevron.down", label: "Lower setpoint", size: 76) { store.send(.target(store.climate.target - 1)) }.disabled(store.climate.target == 67)
                    Text("\(store.climate.target)").font(.system(size: 240, weight: .ultraLight)).monospacedDigit().accessibilityIdentifier("climate-value")
                    CircleButton(symbol: "chevron.up", label: "Raise setpoint", size: 76) { store.send(.target(store.climate.target + 1)) }.disabled(store.climate.target == 77)
                }
            }
            HStack(spacing: 20) {
                Label("Now \(store.climate.ambient)°", systemImage: "thermometer.medium")
                Text(store.climate.action)
                if store.pending.contains("climate") { ProgressView() }
            }.font(.system(size: 26)).foregroundStyle(.white.opacity(0.75))
            Spacer(minLength: 20)
            HStack(spacing: 14) {
                ForEach(ClimateMode.allCases, id: \.self) { mode in
                    Choice(title: mode.label, selected: store.climate.mode == mode) { store.send(.mode(mode)) }.accessibilityIdentifier("mode-\(mode.rawValue)")
                }
            }
            HStack {
                Spacer()
                Button { store.send(.toggle(.fan)) } label: {
                    Label("Fan · \(store.climate.fanLabel)", systemImage: "fan.fill").font(.system(size: 21, weight: .medium)).padding(14)
                }.buttonStyle(.glass).accessibilityIdentifier("climate-fan")
                    .overlay(alignment: .trailing) { if store.pending.contains("fan") { ProgressView() } }
            }.padding(.horizontal, 44).padding(.bottom, 26)
        }
    }
    private var caption: String {
        switch store.climate.mode { case .cool: "Cooling to"; case .heat: "Heating to"; case .heatCool: "Temperature range"; case .off: "Climate" }
    }
    private func rangeValue(value: Int, label: String, low: Bool) -> some View {
        VStack(spacing: 14) {
            Text(label).font(.system(size: 22)).opacity(0.7)
            Text("\(value)°").font(.system(size: 140, weight: .ultraLight)).monospacedDigit()
            HStack(spacing: 30) {
                CircleButton(symbol: "chevron.down", label: "Lower \(label)") { store.send(low ? .low(value - 1) : .high(value - 1)) }
                    .disabled(low ? value == 67 : value == store.climate.low + 2)
                CircleButton(symbol: "chevron.up", label: "Raise \(label)") { store.send(low ? .low(value + 1) : .high(value + 1)) }
                    .disabled(low ? value == store.climate.high - 2 : value == 77)
            }
        }
    }
}
struct ControlsController: View {
    let store: any HomeDataSource
    @State private var editingSlot: Int?
    @State private var editingColors = false
    @State private var draftHex = ""
    var body: some View {
        GeometryReader { proxy in
            HStack(alignment: .center, spacing: 54) {
                VStack(spacing: 18) {
                    Text("Lamp brightness").font(.system(size: 25)).opacity(0.75)
                    HStack(alignment: .firstTextBaseline, spacing: 0) {
                        Text("\(store.lamps.brightness)").font(.system(size: 154, weight: .ultraLight)).monospacedDigit()
                        Text("%").font(.system(size: 52, weight: .light)).opacity(0.65)
                    }
                    Slider(value: Binding(get: { Double(store.lamps.brightness) }, set: { store.send(.brightness(Int($0))) }), in: 0...100, step: 1)
                        .disabled(!store.lamps.anyOn).accessibilityLabel("Lamp brightness")
                    HStack { Text("0%"); Spacer(); Text("100%") }.font(.system(size: 16)).opacity(0.6)
                    Spacer(minLength: 12)
                    LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                        ForEach([Accessory.all, .fan, .lamps, .lights, .bedroom, .livingRoom, .ceiling, .cabinet]) { key in
                            toggle(key)
                        }
                    }
                }.frame(width: proxy.size.width * 0.43)
                VStack(alignment: .leading, spacing: 24) {
                    SectionLabel(text: "Lamp scene")
                    HStack(spacing: 16) {
                        scene("White", colors: [Color(hex: "#ffe3b7"), .white])
                        scene("Mood", colors: [Color(hex: "#a855f7"), Color(hex: "#3b82f6"), Color(hex: "#ec4899")])
                    }
                    VStack(spacing: 10) {
                        HStack { SectionLabel(text: "White temperature"); Spacer(); Text("\(store.lamps.kelvin) K").font(.system(size: 22)) }
                        Slider(value: Binding(get: { Double(store.lamps.kelvin) }, set: { store.send(.kelvin(Int($0))) }), in: 2000...6500, step: 100).accessibilityLabel("White temperature")
                        HStack { Text("2000 K"); Spacer(); Text("6500 K") }.font(.system(size: 15)).opacity(0.6)
                    }.disabled(!store.lamps.anyOn).opacity(store.lamps.anyOn ? 1 : 0.4)
                    HStack {
                        SectionLabel(text: "Colors"); Spacer()
                        Button(editingColors ? "Done" : "Edit") { editingColors.toggle() }.buttonStyle(.glass)
                    }
                    HStack(spacing: 28) {
                        ForEach(0..<3) { slot in
                            Button {
                                if editingColors { draftHex = store.lamps.colors[slot]; editingSlot = slot }
                                else { store.send(.color(slot, nil)) }
                            } label: {
                                VStack(spacing: 12) {
                                    Circle().fill(Color(hex: store.lamps.colors[slot])).frame(width: 72, height: 72)
                                        .overlay(Circle().strokeBorder(.white.opacity(0.9), lineWidth: store.lamps.activeColor == slot ? 4 : 1))
                                        .overlay { if editingColors { Image(systemName: "pencil").font(.system(size: 24)) } }
                                    Text("Custom \(slot + 1)").font(.system(size: 17, weight: .medium))
                                }.frame(maxWidth: .infinity)
                            }.buttonStyle(.plain).accessibilityLabel("\(editingColors ? "Edit" : "Use") Custom \(slot + 1)")
                        }
                    }
                    SectionLabel(text: "Party")
                    HStack(spacing: 12) {
                        ForEach(PartySpeed.allCases, id: \.self) { speed in
                            Choice(title: speed.rawValue, selected: store.lamps.party == speed) { store.send(.party(speed)) }
                        }
                    }.disabled(!store.lamps.anyOn).opacity(store.lamps.anyOn ? 1 : 0.4)
                }.frame(maxWidth: .infinity)
            }.padding(.horizontal, 64).padding(.vertical, 38)
        }
        .sheet(isPresented: Binding(get: { editingSlot != nil }, set: { if !$0 { editingSlot = nil } })) {
            VStack(alignment: .leading, spacing: 24) {
                Text("Edit Custom \((editingSlot ?? 0) + 1)").font(.system(size: 28, weight: .semibold))
                RoundedRectangle(cornerRadius: 24).fill(Color(hex: draftHex)).frame(height: 120)
                TextField("Hex color", text: $draftHex).textFieldStyle(.roundedBorder).font(.system(size: 24)).accessibilityLabel("Hex color")
                Text("Use a six-digit hex color, such as #0066ff.").foregroundStyle(.secondary)
                HStack {
                    Button("Cancel") { editingSlot = nil }.keyboardShortcut(.cancelAction)
                    Spacer()
                    Button("Save & use") {
                        if let slot = editingSlot { store.send(.color(slot, draftHex)) }; editingSlot = nil
                    }.disabled(draftHex.range(of: "^#[0-9A-Fa-f]{6}$", options: .regularExpression) == nil).keyboardShortcut(.defaultAction)
                }.buttonStyle(.glass)
            }.padding(32).frame(width: 440)
        }
    }
    private func toggle(_ key: Accessory) -> some View {
        let on = key == .fan ? store.climate.fanOn && store.climate.mode != .off : store.lamps.isOn(key)
        return Button { store.send(.toggle(key)) } label: {
            HStack(spacing: 12) {
                Image(systemName: key.symbol).font(.system(size: 23)).foregroundStyle(on ? Palette.amber : .white)
                VStack(alignment: .leading, spacing: 3) {
                    Text(key.name).font(.system(size: 17, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.8)
                    Text(key == .fan ? store.climate.fanLabel : on ? "On" : "Off").font(.system(size: 14)).opacity(0.6)
                }
                Spacer(minLength: 0)
                if store.pending.contains(key.rawValue) { ProgressView() }
            }.padding(.horizontal, 16).frame(height: 67).foregroundStyle(on ? Palette.ink : .white)
        }.buttonStyle(.plain).homeGlass(on: on, radius: 23)
            .accessibilityLabel("Toggle \(key.name)").accessibilityIdentifier("controller-toggle-\(key.rawValue)")
    }
    private func scene(_ name: String, colors: [Color]) -> some View {
        Button { store.send(.scene(name)) } label: {
            HStack(spacing: 12) {
                Circle().fill(LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)).frame(width: 32, height: 32)
                Text(name).font(.system(size: 21, weight: .semibold))
                Spacer()
                if store.lamps.scene == name && store.lamps.party == .off { Image(systemName: "checkmark") }
            }.padding(17)
        }.buttonStyle(.glass)
    }
}
struct WifiController: View {
    let wifi: WifiState
    var body: some View {
        VStack(spacing: 36) {
            Spacer()
            Image(systemName: "wifi").font(.system(size: 85, weight: .light)).opacity(0.85)
            if let ssid = wifi.ssid, !ssid.isEmpty {
                VStack(spacing: 12) {
                    Text("Network").font(.system(size: 23)).opacity(0.6)
                    Text(ssid).font(.system(size: 86, weight: .light)).textSelection(.enabled)
                }
                VStack(spacing: 14) {
                    Text(wifi.password?.isEmpty == false ? "Password" : "Open network").font(.system(size: 23)).opacity(0.6)
                    Text(wifi.password.flatMap { $0.isEmpty ? nil : $0 } ?? "No password")
                        .font(.system(size: 48, weight: .medium, design: .monospaced)).textSelection(.enabled)
                }.padding(.horizontal, 45).padding(.vertical, 30)
                    .glassEffect(.regular, in: .rect(cornerRadius: 34))
            } else {
                Text("Guest network not configured").font(.system(size: 48, weight: .light))
            }
            Spacer()
        }.padding(40)
    }
}
struct ControllerPreview: View {
    let tile: HomeTile
    var mode: ClimateMode = .cool
    var body: some View {
        let store = MockHomeDataSource(mode: mode)
        ControllerHost(tile: tile, store: store, close: {}).background(tile.fill(store)).environment(\.colorScheme, .dark)
    }
}
#Preview("Controls", traits: .fixedLayout(width: 1366, height: 1024)) { ControllerPreview(tile: .lamps) }
#Preview("Climate · Cool", traits: .fixedLayout(width: 1366, height: 1024)) { ControllerPreview(tile: .climate) }
#Preview("Climate · Heat·Cool", traits: .fixedLayout(width: 1366, height: 1024)) { ControllerPreview(tile: .climate, mode: .heatCool) }
#Preview("Guest Wi-Fi", traits: .fixedLayout(width: 1366, height: 1024)) { ControllerPreview(tile: .wifi) }
#Preview("Climate · Heat", traits: .fixedLayout(width: 1366, height: 1024)) { ControllerPreview(tile: .climate, mode: .heat) }
#Preview("Climate · Off", traits: .fixedLayout(width: 1366, height: 1024)) { ControllerPreview(tile: .climate, mode: .off) }
#Preview("Wi-Fi · Open", traits: .fixedLayout(width: 1366, height: 1024)) { WifiController(wifi: .open).background(Palette.teal) }
#Preview("Wi-Fi · Not configured", traits: .fixedLayout(width: 1366, height: 1024)) { WifiController(wifi: .unconfigured).background(Palette.teal) }

// Preserve the panel's generous control layout as a desktop window gets smaller.
// At iPad / panel dimensions this is a 1:1 layout, with no scaling.
struct ControllerCanvas<Content: View>: View {
    @ViewBuilder let content: Content
    var body: some View {
        GeometryReader { proxy in
            let scale = min(1, min(proxy.size.width / 1280, proxy.size.height / 790))
            content.frame(width: proxy.size.width / scale, height: proxy.size.height / scale)
                .scaleEffect(scale)
                .frame(width: proxy.size.width, height: proxy.size.height)
        }
    }
}
