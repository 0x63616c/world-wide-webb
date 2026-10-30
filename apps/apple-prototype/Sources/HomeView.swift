import SwiftUI

enum HomeTile: String, CaseIterable, Identifiable {
    case climate, clock, wifi, bedroom, livingRoom, ceiling, cabinet, fan, all
    // Existing controllers stay available by launch argument for later faces.
    case lamps, lights, weather, hourly, sound, alarm, tesla
    static let homeFace: [HomeTile] = [.climate, .clock, .wifi, .bedroom, .livingRoom, .ceiling]
    static let controlsFace: [HomeTile] = [.weather, .tesla, .sound, .cabinet, .fan, .all]
    var id: String { rawValue }
    var title: String {
        switch self {
        case .climate: "Climate · A/C"
        case .clock: "Clock"
        case .bedroom: "Bedroom Lamps"
        case .livingRoom: "Living Room Lamps"
        case .lamps: "Lamps"
        case .ceiling: "Ceiling"
        case .cabinet: "Under Cabinet"
        case .all, .fan, .lights: "Controls"
        case .wifi: "Guest Wi-Fi"
        case .weather: "Weather Now"
        case .hourly: "Next 12 Hours"
        case .sound: "Sound System"
        case .alarm: "Next alarm"
        case .tesla: "Car"
        }
    }
    var accessory: Accessory? {
        switch self {
        case .bedroom: .bedroom
        case .livingRoom: .livingRoom
        case .ceiling: .ceiling
        case .cabinet: .cabinet
        case .fan: .fan
        case .all: .all
        case .lamps: .lamps
        case .lights: .lights
        default: nil
        }
    }
    var cells: (x: Int, y: Int, w: Int, h: Int) {
        switch self {
        case .climate: (0,0,2,2)
        case .clock: (2,0,1,1)
        case .wifi: (2,1,1,1)
        case .bedroom: (0,2,1,1)
        case .livingRoom: (1,2,1,1)
        case .ceiling: (2,2,1,1)
        case .cabinet: (0,2,1,1)
        case .fan: (1,2,1,1)
        case .all: (2,2,1,1)
        case .weather: (0,0,2,2)
        case .tesla: (2,0,1,1)
        case .sound: (2,1,1,1)
        default: (0,0,1,1)
        }
    }
    @MainActor func fill(_ store: any HomeDataSource) -> Color {
        switch self {
        case .climate: store.climate.mode.color
        case .all, .fan, .lamps, .lights, .bedroom, .livingRoom, .ceiling, .cabinet: Palette.amber
        case .clock: Palette.teal
        case .wifi: Palette.teal
        case .weather, .hourly: Color.blue.mix(with: .black, by: 0.45)
        case .sound: Color.purple.mix(with: .black, by: 0.65)
        case .alarm, .tesla: .black
        }
    }
}
struct HomeView: View {
    let store: any HomeDataSource
    var initialTile: HomeTile?
    var demo = false
    var initialFace = 0
    var initialPresence = false
    @State private var presenceNear = false
    @State private var facePage = 0
    @Namespace private var zoom
    @State private var selected: HomeTile?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Wallpaper()
                homeFace(size: proxy.size)
                if selected == nil {
                    VStack { Spacer(); FacePicker(selection: $facePage).padding(.bottom, 10) }
                }
                #if os(macOS)
                if let selected { destination(selected) }
                #endif
            }.foregroundStyle(.primary).tint(.white)
                .environment(\.colorScheme, .dark)
                #if os(iOS)
                .fullScreenCover(item: $selected) { tile in
                    if reduceMotion { destination(tile) }
                    else { destination(tile).navigationTransition(.zoom(sourceID: tile == .alarm ? HomeTile.clock.id : tile.id, in: zoom)) }
                }
                #else
                .onExitCommand { selected = nil }
                #endif
                .task {
                    facePage = initialFace
                    presenceNear = initialPresence
                    if let initialTile {
                        try? await Task.sleep(for: .milliseconds(250))
                        open(initialTile)
                    }
                    if ProcessInfo.processInfo.arguments.contains("-demoAutoPage") && !reduceMotion {
                        if !store.climate.fanOn { store.send(.toggle(.fan)) }
                        try? await Task.sleep(for: .seconds(5))
                        withAnimation(.smooth) { facePage = 1 }
                        try? await Task.sleep(for: .seconds(5))
                        withAnimation(.smooth) { facePage = 3 }
                    }
                }
        }.ignoresSafeArea()
    }
    @ViewBuilder private func destination(_ tile: HomeTile) -> some View {
        ZStack {
            if [.lamps, .bedroom, .livingRoom].contains(tile) { LampsBackdrop() }
            else { tile.fill(store).ignoresSafeArea() }
            if tile == .alarm {
                AlarmRingView(store: store, close: { selected = nil }) { selected = .clock }
            } else {
                ControllerHost(tile: tile, store: store, close: { selected = nil })
            }
        }.preferredColorScheme(.dark).foregroundStyle(.primary)
            .onKeyPress(.escape) { selected = nil; return .handled }
    }
    @ViewBuilder private func homeFace(size: CGSize) -> some View {
        #if os(iOS)
        TabView(selection: $facePage) {
            faceGrid(size: size, controls: false).tag(0)
            faceGrid(size: size, controls: true).tag(1)
            PresenceClockFace(store: store, near: $presenceNear, open: open).tag(2)
            NowPlayingView(store: store) { facePage = 0 }.tag(3)
        }.tabViewStyle(.page(indexDisplayMode: .never)).ignoresSafeArea()
        #else
        Group {
            if facePage == 2 { PresenceClockFace(store: store, near: $presenceNear, open: open) }
            else if facePage == 3 { NowPlayingView(store: store) { facePage = 0 } }
            else { faceGrid(size: size, controls: facePage == 1) }
        }
        #endif
    }
    private func faceGrid(size: CGSize, controls: Bool) -> some View {
        HomeGlassFace(store: store, size: size, controls: controls, zoom: zoom, open: open)
    }
    private func open(_ tile: HomeTile) {
        selected = tile == .clock ? .alarm : tile
    }
}
// Shared by the live pager and the fast snapshot target; no duplicate visual layout.
struct FacePicker: View {
    @Binding var selection: Int
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        HStack(spacing: 10) {
            ForEach(0..<4) { page in
                Button { withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.25)) { selection = page } } label: {
                    Circle().fill(.white.opacity(selection == page ? 0.95 : 0.3))
                        .frame(width: 8, height: 8).frame(width: 30, height: 34)
                }.buttonStyle(.plain)
                    .accessibilityLabel(["Home face", "Controls face", "Clock face", "Music face"][page])
                    .accessibilityValue(selection == page ? "Selected" : "")
                    .accessibilityIdentifier("face-page-\(page)")
            }
        }
        .overlay(alignment: .trailing) {
            Text("Fixture data").font(.system(size: 11)).opacity(0.4)
                .fixedSize().offset(x: 110).allowsHitTesting(false)
        }
    }
}
struct HomeGlassFace: View {
    let store: any HomeDataSource
    let size: CGSize
    let controls: Bool
    var selected: HomeTile?
    let zoom: Namespace.ID
    let open: (HomeTile) -> Void
    @Environment(\.horizontalSizeClass) private var sizeClass
    var body: some View {
        if sizeClass == .compact {
            CompactFace(store: store, controls: controls, zoom: zoom, open: open)
        } else {
            GlassEffectContainer(spacing: 16) {
                HomeFaceGrid(store: store, size: size, controls: controls, selected: selected, zoom: zoom, open: open)
            }
        }
    }
}
struct HomeFaceGrid: View {
    let store: any HomeDataSource
    let size: CGSize
    let controls: Bool
    var selected: HomeTile?
    let zoom: Namespace.ID
    let open: (HomeTile) -> Void
    var body: some View {
        let faceH = size.height - 96
        let faceW = min(size.width - 80, faceH * 1.10)
        let gap: CGFloat = 24
        let cellW = (faceW - gap * 2) / 3
        let cellH = (faceH - gap * 2) / 3
        let contentScale = cellH / 297.33
        return ZStack(alignment: .topLeading) {
            ForEach(controls ? HomeTile.controlsFace : HomeTile.homeFace) { tile in
                let c = tile.cells
                let width = cellW * Double(c.w) + gap * Double(c.w - 1)
                let height = cellH * Double(c.h) + gap * Double(c.h - 1)
                let surfaceWidth = tile == .clock ? min(width, height) : width
                let radius = tile == .clock ? height / 2 : 54 * contentScale
                ZStack {
                    if selected != tile {
                        TileFace(tile: tile, store: store, open: { open(tile) })
                            .frame(width: surfaceWidth / contentScale, height: height / contentScale)
                            .scaleEffect(contentScale)
                            .frame(width: surfaceWidth, height: height)
                            .modifier(FaceMaterial(tile: tile, on: tileOn(tile), radius: radius))
                            .matchedTransitionSource(id: tile.id, in: zoom)
                    } else {
                        Color.clear
                    }
                }
                .frame(width: width, height: height)
                .contentShape(RoundedRectangle(cornerRadius: radius, style: .continuous))
                .onTapGesture { open(tile) }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("tile-\(tile.id)")
                .accessibilityAction(named: "Open \(tile.title)") { open(tile) }
                .offset(x: Double(c.x) * (cellW + gap), y: Double(c.y) * (cellH + gap))
            }
        }
        .frame(width: faceW, height: faceH, alignment: .topLeading)
        .frame(width: size.width, height: size.height - 16, alignment: .center)
        .frame(width: size.width, height: size.height, alignment: .top)
    }
    private func tileOn(_ tile: HomeTile) -> Bool {
        guard let key = tile.accessory else { return false }
        return key == .fan ? store.climate.fanOn && store.climate.mode != .off : store.lamps.isOn(key)
    }
}
struct TileFace: View {
    let tile: HomeTile
    let store: any HomeDataSource
    let open: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.motionPhase) private var motionPhase
    var body: some View {
        if let key = tile.accessory {
            AccessoryFace(key: key, store: store, open: open)
        } else {
            switch tile {
            case .climate: climate
            case .clock:
                TimelineView(.animation(minimumInterval: reduceMotion ? 1 : 1.0 / 30, paused: motionPhase != nil)) { _ in
                    AnalogClock(date: store.now, minimal: true)
                        .aspectRatio(1, contentMode: .fit).padding(20)
                }
            case .tesla: TeslaTile(provider: store.tesla)
            case .weather: WeatherTile(weather: store.weather)
            case .sound:
                if let room = store.rooms.first { SonosTile(room: room) }
            case .wifi:
                VStack(spacing: 0) {
                    Image(systemName: "wifi").font(.system(size: 70, weight: .regular))
                        .frame(height: 96).padding(.bottom, 20)
                    Text("Guest Wi-Fi").font(.system(size: 32, weight: .semibold))
                    Text(store.wifi.ssid.flatMap { $0.isEmpty ? nil : $0 } ?? "Not configured")
                        .font(.system(size: 24)).foregroundStyle(.secondary).padding(.top, 8)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            default: EmptyView()
            }
        }
    }
    private var climate: some View {
        GeometryReader { proxy in
            VStack(spacing: 0) {
                Text(store.climate.mode == .off ? "Off" : store.climate.mode == .heatCool ? "\(store.climate.low)–\(store.climate.high)" : "\(store.climate.target)")
                    .font(.system(size: proxy.size.height * (store.climate.mode == .heatCool ? 0.29 : 0.46), weight: .regular))
                    .monospacedDigit().contentTransition(.numericText()).minimumScaleFactor(0.5).lineLimit(1)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                HStack(alignment: .center) {
                    setpointButton("chevron.down", label: "Lower setpoint", delta: -1)
                    Spacer(minLength: 0)
                    VStack(spacing: 8) {
                        Text("Climate").font(.system(size: 34, weight: .semibold))
                        Text("A/C · \(store.climate.mode == .off ? "Off" : store.climate.action)")
                            .font(.system(size: 27)).opacity(0.65)
                    }
                    Spacer(minLength: 0)
                    setpointButton("chevron.up", label: "Raise setpoint", delta: 1)
                }.padding(.bottom, 8)
            }.padding(38)
                .overlay(alignment: .topTrailing) { if store.pending.contains("climate") { ProgressView().padding(26) } }

        }
    }
    private func setpointButton(_ symbol: String, label: String, delta: Int) -> some View {
        Button { step(delta) } label: {
            Image(systemName: symbol).font(.system(size: 62, weight: .semibold))
                .frame(width: 92, height: 92).contentShape(Circle())
        }.buttonStyle(.plain)
            .disabled(store.climate.mode == .off)
            .accessibilityLabel(label)
            .accessibilityIdentifier(delta < 0 ? "tile-climate-down" : "tile-climate-up")
    }
    private func step(_ delta: Int) {
        store.send(store.climate.mode == .heatCool ? .shiftRange(delta) : .target(store.climate.target + delta))
    }
}
struct AccessoryFace: View {
    let key: Accessory
    let store: any HomeDataSource
    let open: () -> Void
    var on: Bool { key == .fan ? store.climate.fanOn && store.climate.mode != .off : store.lamps.isOn(key) }
    var title: String { key == .bedroom ? "Bedroom" : key == .livingRoom ? "Living Room" : key == .ceiling ? "Ceiling" : key.name }
    var subtitle: String {
        switch key {
        case .all: "Everything"
        case .fan: "A/C · \(store.climate.fanLabel)"
        case .lamps, .lights: on ? "On" : "Off"
        case .bedroom: "\(store.lamps.onCount(.bedroom)) lamps on"
        case .livingRoom: store.lamps.isOn(.livingRoom) ? "\(store.lamps.onCount(.livingRoom)) lamps on" : "Lamps off"
        case .ceiling: on ? "Lights on" : "Lights off"
        case .cabinet: "Kitchen"
        }
    }
    var body: some View {
        VStack(spacing: 0) {
            Button { store.send(.toggle(key)) } label: {
                Group {
                    if key == .fan { FanSymbol(on: on) }
                    else { Image(systemName: key.symbol).symbolRenderingMode(.hierarchical) }
                }.font(.system(size: 64, weight: .regular))
                    .foregroundStyle(on ? Color.orange : .white)
                    .frame(width: 120, height: 100)
                    .background { if key != .fan { LampGlow(on: on, brightness: store.lamps.brightness).frame(width: 200, height: 180) } }
                    .overlay(alignment: .topTrailing) { if store.pending.contains(key.rawValue) { ProgressView().tint(on ? Palette.ink : .white) } }
            }.buttonStyle(.plain).padding(.bottom, 20)
                .accessibilityLabel("Toggle \(key.name)").accessibilityValue(on ? "On" : "Off").accessibilityIdentifier("toggle-\(key.rawValue)")
            Button(action: open) {
                VStack(spacing: 7) {
                    Text(title).font(.system(size: key == .cabinet ? 30 : 32, weight: .semibold)).lineLimit(1)
                    Text(subtitle).font(.system(size: 24)).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity)
            }.buttonStyle(.plain).accessibilityLabel("Open \(key.name)")
        }.foregroundStyle(.primary).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
#Preview("Home face · 1376 × 1032", traits: .fixedLayout(width: 1376, height: 1032)) { HomeView(store: MockHomeDataSource()) }
