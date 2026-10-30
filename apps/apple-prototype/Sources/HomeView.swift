import SwiftUI

enum HomeTile: String, CaseIterable, Identifiable {
    case climate, clock, wifi, bedroom, livingRoom, ceiling, cabinet, fan, all
    // Existing controllers stay available by launch argument for later faces.
    case lamps, lights, weather, hourly, sound
    static let homeFace: [HomeTile] = [.climate, .clock, .wifi, .bedroom, .livingRoom, .ceiling, .cabinet, .fan, .all]
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
        case .wifi: (3,0,1,1)
        case .bedroom: (2,1,1,1)
        case .livingRoom: (3,1,1,1)
        case .ceiling: (0,2,1,1)
        case .cabinet: (1,2,1,1)
        case .fan: (2,2,1,1)
        case .all: (3,2,1,1)
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
        }
    }
}
struct HomeView: View {
    let store: any HomeDataSource
    var initialTile: HomeTile?
    var demo = false
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
                    VStack { Spacer(); Text("Fixture data").font(.system(size: 11)).opacity(0.4).padding(.bottom, 10) }.allowsHitTesting(false)
                }
                if let tile = selected {
                    ZStack {
                        GlassSurface(radius: contentVisible ? 0 : 38)
                        tile.fill(store).opacity(contentVisible ? 1 : 0)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: contentVisible ? 0 : 38, style: .continuous))
                    .matchedGeometryEffect(id: tile.id, in: zoom)
                    .ignoresSafeArea().zIndex(2)
                    ControllerHost(tile: tile, store: store, headerVisible: headerVisible, close: dismiss)
                        .opacity(contentVisible ? 1 : 0)
                        .zIndex(3)
                        .simultaneousGesture(DragGesture(minimumDistance: 50).onEnded { value in
                            if value.startLocation.y < 150 && value.translation.height > 100 && abs(value.translation.width) < 100 { dismiss() }
                        })
                }
            }.foregroundStyle(.white)
                .environment(\.colorScheme, .dark)
                .onKeyPress(.escape) { if selected != nil { dismiss(); return .handled }; return .ignored }
                #if os(macOS)
                .onExitCommand(perform: dismiss)
                #endif
                .task {
                    if let initialTile { try? await Task.sleep(for: .milliseconds(250)); open(initialTile) }
                    if demo && !reduceMotion {
                        try? await Task.sleep(for: .seconds(2))
                        for tile in HomeTile.homeFace {
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
    @ViewBuilder private func homeFace(size: CGSize) -> some View {
        // Only one face in iteration 1. Do not imply that unfinished pages exist.
        #if os(iOS)
        TabView {
            GlassEffectContainer(spacing: 12) { homeGrid(size: size) }.tag(0)
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .ignoresSafeArea()
        #else
        GlassEffectContainer(spacing: 12) { homeGrid(size: size) }
        #endif
    }
    private func homeGrid(size: CGSize) -> some View {
        let margin: CGFloat = 40
        let gap: CGFloat = 24
        let cellW = (size.width - margin * 2 - gap * 3) / 4
        let cellH = (size.height - margin * 2 - gap * 2) / 3
        let contentScale = min(1, min(cellW / 306, cellH / 301))
        return ZStack(alignment: .topLeading) {
            ForEach(HomeTile.homeFace) { tile in
                let c = tile.cells
                let width = cellW * Double(c.w) + gap * Double(c.w - 1)
                let height = cellH * Double(c.h) + gap * Double(c.h - 1)
                ZStack {
                    if selected != tile {
                        TileFace(tile: tile, store: store, open: { open(tile) })
                            .frame(width: width / contentScale, height: height / contentScale)
                            .scaleEffect(contentScale)
                            .frame(width: width, height: height)
                            .faceGlass(on: tileOn(tile), radius: 42)
                            .matchedGeometryEffect(id: tile.id, in: zoom)
                            .transition(.opacity)
                    } else {
                        Color.clear
                    }
                }
                .frame(width: width, height: height)
                .contentShape(RoundedRectangle(cornerRadius: 42, style: .continuous))
                .onTapGesture { open(tile) }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("tile-\(tile.id)")
                .accessibilityAction(named: "Open \(tile.title)") { open(tile) }
                .offset(x: Double(c.x) * (cellW + gap), y: Double(c.y) * (cellH + gap))
            }
        }.frame(width: size.width - margin * 2, height: size.height - margin * 2, alignment: .topLeading)
            .padding(margin)
    }
    private func tileOn(_ tile: HomeTile) -> Bool {
        guard let key = tile.accessory else { return false }
        return key == .fan ? store.climate.fanOn && store.climate.mode != .off : store.lamps.isOn(key)
    }
    private func open(_ tile: HomeTile) {
        guard selected == nil, !transitioning else { return }
        transitioning = true
        withAnimation(spring) { selected = tile }
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
                        .aspectRatio(1, contentMode: .fit).padding(24)
                }
            case .wifi:
                VStack(spacing: 0) {
                    Image(systemName: "wifi").font(.system(size: 50, weight: .regular))
                        .frame(height: 88).padding(.bottom, 20)
                    Text("Guest Wi-Fi").font(.system(size: 26, weight: .semibold))
                    Text(store.wifi.ssid.flatMap { $0.isEmpty ? nil : $0 } ?? "Not configured")
                        .font(.system(size: 20)).foregroundStyle(.white.opacity(0.6)).padding(.top, 7)
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            default: EmptyView()
            }
        }
    }
    private var climate: some View {
        GeometryReader { proxy in
            VStack(alignment: .leading, spacing: 0) {
                Text(store.climate.mode == .off ? "Off" : store.climate.mode == .heatCool ? "\(store.climate.low)–\(store.climate.high)" : "\(store.climate.target)")
                    .font(.system(size: proxy.size.height * (store.climate.mode == .heatCool ? 0.29 : 0.44), weight: .thin))
                    .tracking(-8).minimumScaleFactor(0.5).lineLimit(1)
                    .padding(.top, 12).padding(.leading, 10)
                Spacer()
                HStack(alignment: .center) {
                    CircleButton(symbol: "chevron.down", label: "Lower setpoint", size: 64, clearGlass: true) { step(-1) }
                        .accessibilityIdentifier("tile-climate-down")
                    Spacer(minLength: 0)
                    VStack(spacing: 8) {
                        Text("Climate").font(.system(size: 28, weight: .semibold))
                        Text("A/C · \(store.climate.mode == .off ? "Off" : store.climate.action)")
                            .font(.system(size: 21)).opacity(0.6)
                    }
                    Spacer(minLength: 0)
                    CircleButton(symbol: "chevron.up", label: "Raise setpoint", size: 64, clearGlass: true) { step(1) }
                        .accessibilityIdentifier("tile-climate-up")
                }.disabled(store.climate.mode == .off)
            }.padding(38)
                .overlay(alignment: .topTrailing) { if store.pending.contains("climate") { ProgressView().padding(26) } }
        }
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
    var title: String { key == .bedroom || key == .livingRoom ? "Lamps" : key.name }
    var subtitle: String {
        switch key {
        case .all: "Everything"
        case .fan: "A/C · \(store.climate.fanLabel)"
        case .lamps, .lights: on ? "On" : "Off"
        case .bedroom: "Bedroom"
        case .livingRoom: "Living Room"
        case .ceiling: "Lights"
        case .cabinet: "Kitchen"
        }
    }
    var body: some View {
        VStack(spacing: 0) {
            Button { store.send(.toggle(key)) } label: {
                Image(systemName: key.symbol).font(.system(size: 50, weight: .regular))
                    .foregroundStyle(on ? Color(hex: "#d49108") : .white)
                    .frame(width: 100, height: 88)
                    .overlay(alignment: .topTrailing) { if store.pending.contains(key.rawValue) { ProgressView().tint(on ? Palette.ink : .white) } }
            }.buttonStyle(.plain).padding(.bottom, 20)
                .accessibilityLabel("Toggle \(key.name)").accessibilityValue(on ? "On" : "Off").accessibilityIdentifier("toggle-\(key.rawValue)")
            Button(action: open) {
                VStack(spacing: 7) {
                    Text(title).font(.system(size: 26, weight: .semibold))
                    Text(subtitle).font(.system(size: 20)).opacity(0.6)
                }.frame(maxWidth: .infinity)
            }.buttonStyle(.plain).accessibilityLabel("Open \(key.name)")
        }.foregroundStyle(on ? Palette.ink : .white).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
#Preview("Home face · 1376 × 1032", traits: .fixedLayout(width: 1376, height: 1032)) { HomeView(store: MockHomeDataSource()) }
