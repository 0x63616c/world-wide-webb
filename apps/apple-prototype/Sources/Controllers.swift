import SwiftUI

struct ControllerHost: View {
    let tile: HomeTile
    let store: any HomeDataSource
    @Environment(\.horizontalSizeClass) private var sizeClass
    var headerVisible = true
    let close: () -> Void
    var body: some View {
        VStack(spacing: 0) {
            ZStack {
                Text([HomeTile.bedroom, .livingRoom].contains(tile) ? "Lamps" : tile.title).font(.system(size: sizeClass == .compact ? 20 : 25, weight: .semibold))
                HStack {
                    CircleButton(symbol: "xmark", label: "Close", clearGlass: [.lamps, .bedroom, .livingRoom].contains(tile), action: close).accessibilityIdentifier("close-controller")
                    Spacer()
                }
            }.frame(height: 62).padding(.horizontal, sizeClass == .compact ? 20 : 38).padding(.top, sizeClass == .compact ? 56 : 30).opacity(headerVisible ? 1 : 0)
            if sizeClass == .compact {
                CompactController(tile: tile, store: store, close: close)
            } else {
            ControllerCanvas {
                switch tile {
                case .all, .fan, .lights, .ceiling, .cabinet: ControlsController(store: store)
                case .lamps, .bedroom, .livingRoom: LampsController(store: store)
                case .climate: ClimateController(store: store)
                case .wifi: WifiController(wifi: store.wifi)
                case .calendar, .media, .sonosRooms, .cameras, .photos, .dogwalk: ModulePage(tile: tile, store: store, close: close)
                case .clock: ClockController(store: store)
                case .weather: WeatherController(weather: store.weather)
                case .hourly: HourlyController(weather: store.weather)
                case .sound: NowPlayingView(store: store, close: close)
                case .tesla: TeslaController(provider: store.tesla)
                case .alarm: AlarmRingView(store: store, close: close, edit: {})
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Text("Fixture data").font(.system(size: 12, weight: .medium)).foregroundStyle(.white.opacity(0.42)).padding(.bottom, 16)
        }
        .foregroundStyle(.white).tint(.white).environment(\.colorScheme, .dark)
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
    var fanIsOn: Bool? = nil
    var body: some View {
        ScrollView {
            GlassEffectContainer(spacing: 16) {
            VStack(alignment: .leading, spacing: 28) {
                Text("Lighting").font(.system(size: 38, weight: .bold))
                HStack(alignment: .top, spacing: 28) {
                    VStack(alignment: .leading, spacing: 28) {
                        VStack(alignment: .leading, spacing: 20) {
                            HStack {
                                Label("Lamps", systemImage: "lamp.table.fill").font(.title2.weight(.semibold))
                                Spacer()
                                Text("\(store.lamps.brightness)%").font(.system(size: 44, weight: .medium, design: .rounded))
                            }
                            Slider(value: Binding(get: { Double(store.lamps.brightness) }, set: { store.send(.brightness(Int($0))) }), in: 0...100, step: 1)
                                .tint(.orange).disabled(!store.lamps.anyOn).accessibilityLabel("Lamp brightness")
                            Text(store.lamps.countLabel()).foregroundStyle(.secondary)
                        }.padding(28).glassEffect(.regular, in: .rect(cornerRadius: 28))
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 16) {
                            ForEach([Accessory.all, .lamps, .bedroom, .livingRoom, .ceiling, .cabinet]) { key in toggle(key) }
                        }
                    }.frame(maxWidth: .infinity)
                    VStack(alignment: .leading, spacing: 24) {
                        Text("Scenes & colour").font(.title2.weight(.semibold))
                        LampEffectsView(store: store)
                    }.padding(28)
                        .frame(maxWidth: .infinity)
                }
            }.padding(40)
            }
        }
    }
    private func toggle(_ key: Accessory) -> some View {
        let on = store.lamps.isOn(key)
        return Button { store.send(.toggle(key)) } label: {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    Image(systemName: key.symbol).font(.system(size: 28)).foregroundStyle(on ? .orange : .gray)
                    Spacer()
                    Image(systemName: "power").font(.system(size: 18)).foregroundStyle(on ? .white : .gray)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(key.name).font(.system(size: 20, weight: .semibold))

                }
            }.padding(22).frame(maxWidth: .infinity, alignment: .leading).foregroundStyle(.white)
                .glassEffect(.regular.tint(on ? .orange.opacity(0.08) : .clear).interactive(), in: .rect(cornerRadius: 24))
        }.buttonStyle(.plain).accessibilityLabel("Toggle \(key.name)")
            .accessibilityIdentifier("controller-toggle-\(key.rawValue)").accessibilityValue(on ? "On" : "Off")
    }
}

struct WifiController: View {
    let wifi: WifiState
    var body: some View {
        GeometryReader { proxy in
            if let ssid = wifi.ssid, !ssid.isEmpty {
                VStack(spacing: 16) {
                    Text("Scan to join").font(.system(size: min(28, proxy.size.width * 0.065), weight: .medium)).padding(.bottom, 8)
                    if let image = WifiQRCode.render(wifi) {
                        WifiQRHero(image: image)
                            .frame(width: min(proxy.size.width - 48, proxy.size.height * 0.66), height: min(proxy.size.width - 48, proxy.size.height * 0.66))
                            .padding(.bottom, 10)
                    }
                    Text(ssid).font(.system(size: min(44, proxy.size.width * 0.09), weight: .semibold)).textSelection(.enabled)
                        .lineLimit(1).minimumScaleFactor(0.6)
                    Text("Password").font(.system(size: 18)).foregroundStyle(.secondary)
                    Text(wifi.password.flatMap { $0.isEmpty ? nil : $0 } ?? "No password")
                        .font(.system(size: min(28, proxy.size.width * 0.06), weight: .medium, design: .monospaced))
                        .textSelection(.enabled).lineLimit(1).minimumScaleFactor(0.5)
                }.frame(maxWidth: .infinity, maxHeight: .infinity).padding(.horizontal, 40)
            } else {
                VStack(spacing: 36) {
                    Image(systemName: "wifi").font(.system(size: 85, weight: .light)).opacity(0.85)
                    Text("Guest network not configured").font(.system(size: 48, weight: .light))
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
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
            let scale = max(0.01, min(1, min(proxy.size.width / 1280, proxy.size.height / 790)))
            content.frame(width: proxy.size.width / scale, height: proxy.size.height / scale)
                .scaleEffect(scale)
                .frame(width: proxy.size.width, height: proxy.size.height)
        }
    }
}
