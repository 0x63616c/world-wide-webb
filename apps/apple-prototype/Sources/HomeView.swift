import SwiftUI

enum HomeTile: String, CaseIterable, Identifiable {
    case climate, clock, wifi, bedroom, livingRoom, ceiling, cabinet, fan, all
    // Existing controllers stay available by launch argument for later faces.
    case lamps, lights, weather, hourly, sound, alarm
    static let homeFace: [HomeTile] = [.climate, .clock, .wifi, .bedroom, .livingRoom, .ceiling]
    static let controlsFace: [HomeTile] = [.cabinet, .fan, .all]
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
        case .cabinet: (0,0,1,1)
        case .fan: (1,0,1,1)
        case .all: (2,0,1,1)
        default: (0,0,1,1)
        }
    }
    @MainActor func fill(_ store: any HomeDataSource) -> Color {
        switch self {
        case .climate: store.climate.mode.color
        case .all, .fan, .lamps, .lights, .bedroom, .livingRoom, .ceiling, .cabinet: Palette.amber
        case .clock: Color(hex: "#235e60")
        case .wifi: Color(hex: "#08746d")
        case .weather, .hourly: Color(hex: "#327b9f")
        case .sound: Color(hex: "#244a64")
        case .alarm: .black
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
    @State private var contentVisible = false
    @State private var headerVisible = false
    @State private var transitioning = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private var spring: Animation? { reduceMotion ? nil : .spring(duration: 0.45, bounce: 0) }
    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Wallpaper()
                homeFace(size: proxy.size)
                .allowsHitTesting(selected == nil && !transitioning)
                .accessibilityHidden(selected != nil)
                if selected == nil {
                    VStack { Spacer(); facePicker.padding(.bottom, 10) }
                }
                if let tile = selected {
                    ZStack {
                        GlassSurface(radius: contentVisible ? 0 : 38)
                        if [.lamps, .bedroom, .livingRoom].contains(tile) {
                            LampsBackdrop().opacity(contentVisible ? 1 : 0)
                        } else {
                            tile.fill(store).opacity(contentVisible ? 1 : 0)
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: contentVisible ? 0 : 38, style: .continuous))
                    .matchedGeometryEffect(id: tile == .alarm ? HomeTile.clock.id : tile.id, in: zoom)
                    .ignoresSafeArea().zIndex(2)
                    controller(tile)
                        .opacity(contentVisible ? 1 : 0)
                        .zIndex(3)
                        .simultaneousGesture(DragGesture(minimumDistance: 50).onEnded { value in
                            if value.startLocation.y < 150 && value.translation.height > 100 && abs(value.translation.width) < 100 { dismiss() }
                        })
                }
            }.foregroundStyle(.white).tint(.white)
                .environment(\.colorScheme, .dark)
                .onKeyPress(.escape) { if selected != nil { dismiss(); return .handled }; return .ignored }
                #if os(macOS)
                .onExitCommand(perform: dismiss)
                #endif
                .task {
                    facePage = initialFace
                    presenceNear = initialPresence
                    if let initialTile {
                        if HomeTile.controlsFace.contains(initialTile) { facePage = 1 }
                        try? await Task.sleep(for: .milliseconds(250)); open(initialTile) }
                    if demo && !reduceMotion {
                        try? await Task.sleep(for: .seconds(2))
                        for tile in HomeTile.homeFace + HomeTile.controlsFace {
                            facePage = HomeTile.controlsFace.contains(tile) ? 1 : 0
                            if Task.isCancelled { break }
                            open(tile)
                            try? await Task.sleep(for: .milliseconds(1100))
                            dismiss()
                            try? await Task.sleep(for: .milliseconds(700))
                        }
                    }
                }
        }.ignoresSafeArea()
    }
    @ViewBuilder private func controller(_ tile: HomeTile) -> some View {
        if tile == .alarm {
            AlarmRingView(store: store, close: dismiss) {
                selected = .clock
            }
        } else {
            ControllerHost(tile: tile, store: store, headerVisible: headerVisible, close: dismiss)
        }
    }
    private var facePicker: some View {
        FacePicker(selection: $facePage)
    }
    @ViewBuilder private func homeFace(size: CGSize) -> some View {
        #if os(iOS)
        TabView(selection: $facePage) {
            GlassEffectContainer(spacing: 12) { faceGrid(size: size, controls: false) }.tag(0)
            GlassEffectContainer(spacing: 12) { faceGrid(size: size, controls: true) }.tag(1)
            PresenceClockFace(store: store, near: $presenceNear, open: open).tag(2)
            NowPlayingView(store: store) { facePage = 0 }.tag(3)
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .ignoresSafeArea()
        #else
        Group {
            if facePage == 2 { PresenceClockFace(store: store, near: $presenceNear, open: open) }
            else if facePage == 3 { NowPlayingView(store: store) { facePage = 0 } }
            else { GlassEffectContainer(spacing: 12) { faceGrid(size: size, controls: facePage == 1) } }
        }.gesture(DragGesture(minimumDistance: 60).onEnded { value in
                if abs(value.translation.width) > abs(value.translation.height) {
                    facePage = min(3, max(0, facePage + (value.translation.width < 0 ? 1 : -1)))
                }
            })
        #endif
    }
    private func faceGrid(size: CGSize, controls: Bool) -> some View {
        HomeFaceGrid(store: store, size: size, controls: controls, selected: selected == .alarm ? .clock : selected, zoom: zoom, open: open)
    }
    private func open(_ tile: HomeTile) {
        guard selected == nil, !transitioning else { return }
        transitioning = true
        withAnimation(spring) { selected = tile == .clock ? .alarm : tile }
        Task { @MainActor in
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.25).delay(0.08)) { contentVisible = true }
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2).delay(0.25)) { headerVisible = true }
            try? await Task.sleep(for: .milliseconds(480))
            transitioning = false
        }
    }
    private func dismiss() {
        guard selected != nil, !transitioning else { return }
        transitioning = true
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.12)) { headerVisible = false; contentVisible = false }
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(reduceMotion ? 0 : 100))
            withAnimation(spring) { selected = nil }
            try? await Task.sleep(for: .milliseconds(450))
            transitioning = false
        }
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
        let gap: CGFloat = 22
        let cellW = (faceW - gap * 2) / 3
        let cellH = (faceH - gap * 2) / 3
        let contentScale = cellH / 297.33
        return ZStack(alignment: .topLeading) {
            if controls {
                Text("Controls").font(.system(size: 40 * contentScale, weight: .semibold))
                    .frame(width: faceW).offset(y: cellH * 0.62)
            }
            ForEach(controls ? HomeTile.controlsFace : HomeTile.homeFace) { tile in
                let c = tile.cells
                let width = cellW * Double(c.w) + gap * Double(c.w - 1)
                let height = cellH * Double(c.h) + gap * Double(c.h - 1)
                let radius = tile == .clock ? height / 2 : 54 * contentScale
                ZStack {
                    if selected != tile {
                        TileFace(tile: tile, store: store, open: { open(tile) })
                            .frame(width: width / contentScale, height: height / contentScale)
                            .scaleEffect(contentScale)
                            .frame(width: width, height: height)
                            .faceGlass(on: tileOn(tile), radius: radius)
                            .matchedGeometryEffect(id: tile.id, in: zoom)
                            .transition(.opacity)
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
                .offset(x: Double(c.x) * (cellW + gap), y: controls ? (faceH - cellH) / 2 : Double(c.y) * (cellH + gap))
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
    var body: some View {
        if let key = tile.accessory {
            AccessoryFace(key: key, store: store, open: open)
        } else {
            switch tile {
            case .climate: climate
            case .clock:
                TimelineView(.animation(minimumInterval: 1.0 / 30)) { _ in
                    AnalogClock(date: store.now, minimal: true)
                        .aspectRatio(1, contentMode: .fit).padding(20)
                }
            case .wifi:
                VStack(spacing: 0) {
                    Image(systemName: "wifi").font(.system(size: 70, weight: .regular))
                        .frame(height: 96).padding(.bottom, 20)
                    Text("Guest Wi-Fi").font(.system(size: 38, weight: .semibold))
                    Text(store.wifi.ssid.flatMap { $0.isEmpty ? nil : $0 } ?? "Not configured")
                        .font(.system(size: 28)).foregroundStyle(.white.opacity(0.65)).padding(.top, 8)
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
                    .tracking(-9).minimumScaleFactor(0.5).lineLimit(1)
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
            Image(systemName: symbol).font(.system(size: 33, weight: .medium))
                .frame(width: 70, height: 70).contentShape(Circle())
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
    var title: String { key == .bedroom || key == .livingRoom ? "Lamps" : key == .ceiling ? "Lights" : key.name }
    var subtitle: String {
        switch key {
        case .all: "Everything"
        case .fan: "A/C · \(store.climate.fanLabel)"
        case .lamps, .lights: on ? "On" : "Off"
        case .bedroom: "Bedroom"
        case .livingRoom: "Living Room"
        case .ceiling: "Ceiling"
        case .cabinet: "Kitchen"
        }
    }
    var body: some View {
        VStack(spacing: 0) {
            Button { store.send(.toggle(key)) } label: {
                Image(systemName: key.symbol).font(.system(size: 76, weight: .regular))
                    .foregroundStyle(on ? Color(hex: "#e7a020") : .white)
                    .frame(width: 120, height: 100)
                    .overlay(alignment: .topTrailing) { if store.pending.contains(key.rawValue) { ProgressView().tint(on ? Palette.ink : .white) } }
            }.buttonStyle(.plain).padding(.bottom, 20)
                .accessibilityLabel("Toggle \(key.name)").accessibilityValue(on ? "On" : "Off").accessibilityIdentifier("toggle-\(key.rawValue)")
            Button(action: open) {
                VStack(spacing: 7) {
                    Text(title).font(.system(size: key == .cabinet ? 34 : 40, weight: .semibold)).lineLimit(1)
                    Text(subtitle).font(.system(size: 28)).opacity(on ? 0.75 : 0.65)
                }.frame(maxWidth: .infinity)
            }.buttonStyle(.plain).accessibilityLabel("Open \(key.name)")
        }.foregroundStyle(on ? Color(hex: "#12302d") : .white).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
#Preview("Home face · 1376 × 1032", traits: .fixedLayout(width: 1376, height: 1032)) { HomeView(store: MockHomeDataSource()) }
