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
struct ControlsController: View {
    let store: any HomeDataSource
    var fanIsOn: Bool? = nil
    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(alignment: .leading, spacing: 36) {
                    HStack {
                        Spacer()
                        Button { store.send(.toggle(.all)) } label: {
                            Label("All lights", systemImage: "power").padding(8)
                        }.buttonStyle(.glass).tint(.orange)
                    }
                    (geometry.size.width < 700 ? AnyLayout(VStackLayout(alignment: .leading, spacing: 24)) : AnyLayout(HStackLayout(alignment: .top, spacing: 48))) {
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 20) {
                            ForEach([Accessory.bedroom, .livingRoom, .ceiling, .cabinet]) { key in toggle(key) }
                        }.frame(maxWidth: .infinity)
                        VStack(alignment: .leading, spacing: 32) {
                            HStack(alignment: .firstTextBaseline) {
                                Text("Lamps").font(.title2.weight(.semibold))
                                Spacer()
                                Text("\(store.lamps.brightness)%").font(.system(size: 56, weight: .medium, design: .rounded)).monospacedDigit()
                            }
                            FilledLevelControl(value: store.lamps.brightness, label: "Lamp brightness", symbol: "sun.max.fill") {
                                store.send(.brightness($0))
                            }.frame(height: 70).disabled(!store.lamps.anyOn)
                                .accessibilityIdentifier("lamp-brightness")
                            LampEffectsView(store: store)
                        }.frame(maxWidth: .infinity).padding(32)
                            .background(.white.opacity(0.045), in: .rect(cornerRadius: 32))
                    }.frame(minHeight: max(0, geometry.size.height - 160), alignment: .center)
                }.padding(geometry.size.width < 700 ? 20 : 44).frame(minHeight: geometry.size.height, alignment: .top)
            }
        }.background(Color.black)
    }
    private func toggle(_ key: Accessory) -> some View {
        let on = store.lamps.isOn(key)
        return Button { store.send(.toggle(key)) } label: {
            VStack(alignment: .leading, spacing: 24) {
                HStack {
                    Image(systemName: key.symbol).font(.system(size: 42)).foregroundStyle(on ? .orange : .gray)
                    Spacer()
                    Image(systemName: "power").font(.system(size: 18)).foregroundStyle(on ? .white : .gray)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(key.name).font(.system(size: 20, weight: .semibold))

                }
            }.padding(28).frame(maxWidth: .infinity, minHeight: 220, alignment: .leading).foregroundStyle(.white)
                .background(on ? Color.orange.opacity(0.15) : Color(white: 0.075), in: .rect(cornerRadius: 28))
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
