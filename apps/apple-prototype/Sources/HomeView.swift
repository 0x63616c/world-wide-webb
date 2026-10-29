import SwiftUI

enum HomeTile: String, CaseIterable, Identifiable {
    case climate, clock, all, fan, lamps, lights, wifi, weather, hourly, sound
    var id: String { rawValue }
    var title: String {
        switch self {
        case .climate: "Climate · A/C"
        case .clock: "Clock"
        case .all, .fan, .lamps, .lights: "Controls"
        case .wifi: "Guest Wi-Fi"
        case .weather: "Weather Now"
        case .hourly: "Next 12 Hours"
        case .sound: "Sound System"
        }
    }
    var cells: (x: Int, y: Int, w: Int, h: Int) {
        switch self {
        case .climate: (0,0,2,2)
        case .clock: (2,0,2,2)
        case .all: (4,0,1,1)
        case .fan: (5,0,1,1)
        case .lamps: (4,1,2,1)
        case .wifi: (0,2,1,1)
        case .weather: (1,2,3,1)
        case .lights: (4,2,2,1)
        case .hourly: (0,3,3,1)
        case .sound: (3,3,3,1)
        }
    }
    @MainActor func fill(_ store: any HomeDataSource) -> Color {
        switch self {
        case .climate: store.climate.mode.color
        case .all, .fan, .lamps, .lights: Palette.amber
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
                GlassEffectContainer(spacing: 8) {
                    homeGrid(size: proxy.size)
                }
                .allowsHitTesting(selected == nil && !transitioning)
                .accessibilityHidden(selected != nil)
                if selected == nil {
                    VStack { Spacer(); Text("Fixture data").font(.system(size: 11)).opacity(0.4).padding(.bottom, 12) }.allowsHitTesting(false)
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
                        for tile in HomeTile.allCases {
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
    private func homeGrid(size: CGSize) -> some View {
        let margin = max(24, min(size.width, size.height) * 0.045)
        let gap: CGFloat = 14
        let cellW = (size.width - margin * 2 - gap * 5) / 6
        let cellH = (size.height - margin * 2 - gap * 3) / 4
        let contentScale = min(1, min(cellW / 198, cellH / 222))
        return ZStack(alignment: .topLeading) {
            ForEach(HomeTile.allCases) { tile in
                let c = tile.cells
                let width = cellW * Double(c.w) + gap * Double(c.w - 1)
                let height = cellH * Double(c.h) + gap * Double(c.h - 1)
                ZStack {
                    if selected != tile {
                        TileFace(tile: tile, store: store, open: { open(tile) })
                            .frame(width: width / contentScale, height: height / contentScale)
                            .scaleEffect(contentScale)
                            .frame(width: width, height: height)
                            .homeGlass(on: tileOn(tile), radius: min(40, cellH * 0.19))
                            .matchedGeometryEffect(id: tile.id, in: zoom)
                            .transition(.opacity)
                    } else {
                        Color.clear
                    }
                }
                .frame(width: width, height: height)
                .contentShape(Rectangle())
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
        switch tile {
        case .all: store.lamps.isOn(.all)
        case .fan: store.climate.fanOn && store.climate.mode != .off
        case .lamps: store.lamps.anyOn
        case .lights: store.lamps.isOn(.lights)
        default: false
        }
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
        switch tile {
        case .all: AccessoryFace(key: .all, store: store, open: open)
        case .fan: AccessoryFace(key: .fan, store: store, open: open)
        case .lamps: GroupFace(master: .lamps, members: [.bedroom, .livingRoom], store: store, open: open)
        case .lights: GroupFace(master: .lights, members: [.ceiling, .cabinet], store: store, open: open)
        case .climate: climate
        case .clock:
            TimelineView(.animation(minimumInterval: 1.0 / 30)) { _ in
                VStack(spacing: 16) {
                    AnalogClock(date: store.now).aspectRatio(1, contentMode: .fit).padding(.horizontal, 22)
                    Text(fixtureTime(store.now, format: "EEEE, MMMM d")).font(.system(size: 21, weight: .medium))
                }.padding(26)
            }
        case .wifi:
            VStack(spacing: 12) {
                Image(systemName: "wifi").font(.system(size: 43, weight: .medium)).padding(.bottom, 4)
                Text("Wi-Fi").font(.system(size: 23, weight: .semibold))
                Text("Guest").font(.system(size: 17)).foregroundStyle(.white.opacity(0.6))
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        case .weather: WeatherFace(weather: store.weather)
        case .hourly:
            VStack(alignment: .leading, spacing: 14) {
                Text("Next 12 Hours").font(.system(size: 21, weight: .semibold))
                HourlyChart(weather: store.weather, compact: true)
            }.padding(24)
        case .sound: SoundFace(store: store)
        }
    }
    private var climate: some View {
        GeometryReader { proxy in
            VStack(alignment: .leading, spacing: 0) {
                Text(store.climate.mode == .off ? "Off" : store.climate.mode == .heatCool ? "\(store.climate.low)–\(store.climate.high)" : "\(store.climate.target)")
                    .font(.system(size: proxy.size.height * (store.climate.mode == .heatCool ? 0.26 : 0.43), weight: .light))
                    .minimumScaleFactor(0.5).lineLimit(1).padding(.top, 5)
                Spacer()
                HStack(alignment: .center) {
                    Button { step(-1) } label: { Image(systemName: "chevron.down").font(.system(size: 28, weight: .medium)).frame(width: 48, height: 56) }
                        .accessibilityLabel("Lower setpoint").accessibilityIdentifier("tile-climate-down")
                    Spacer(minLength: 0)
                    VStack(spacing: 6) {
                        Text("Climate").font(.system(size: 25, weight: .semibold))
                        Text("A/C").font(.system(size: 19)).opacity(0.6)
                    }
                    Spacer(minLength: 0)
                    Button { step(1) } label: { Image(systemName: "chevron.up").font(.system(size: 28, weight: .medium)).frame(width: 48, height: 56) }
                        .accessibilityLabel("Raise setpoint").accessibilityIdentifier("tile-climate-up")
                }.buttonStyle(.plain).disabled(store.climate.mode == .off)
            }.padding(30)
                .overlay(alignment: .topTrailing) { if store.pending.contains("climate") { ProgressView().padding(22) } }
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
    var subtitle: String {
        switch key {
        case .all: "Everything"
        case .fan: store.climate.fanLabel
        case .lamps, .lights: on ? "On" : "Off"
        case .bedroom, .livingRoom: "Lamps"
        case .ceiling, .cabinet: "Lights"
        }
    }
    var body: some View {
        VStack(spacing: 8) {
            Button { store.send(.toggle(key)) } label: {
                Image(systemName: key.symbol).font(.system(size: 39, weight: .regular))
                    .foregroundStyle(on && key != .fan && key != .all ? Color(hex: "#d89b17") : on ? Palette.ink : .white)
                    .frame(width: 72, height: 70)
                    .overlay { if store.pending.contains(key.rawValue) { ProgressView().tint(on ? Palette.ink : .white) } }
            }.buttonStyle(.plain).accessibilityLabel("Toggle \(key.name)").accessibilityValue(on ? "On" : "Off").accessibilityIdentifier("toggle-\(key.rawValue)")
            Button(action: open) {
                VStack(spacing: 7) {
                    Text(key.name).font(.system(size: 23, weight: .semibold))
                    Text(subtitle).font(.system(size: 17)).opacity(0.6)
                }.frame(maxWidth: .infinity)
            }.buttonStyle(.plain).accessibilityLabel("Open \(key.name)")
        }.foregroundStyle(on ? Palette.ink : .white).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
struct GroupFace: View {
    let master: Accessory
    let members: [Accessory]
    let store: any HomeDataSource
    let open: () -> Void
    var on: Bool { store.lamps.isOn(master) }
    var body: some View {
        VStack(spacing: 16) {
            HStack(spacing: 12) {
                Button { store.send(.toggle(master)) } label: {
                    Image(systemName: master.symbol).font(.system(size: 29)).foregroundStyle(on ? Color(hex: "#ce9014") : .white).frame(width: 48, height: 48)
                }.buttonStyle(.plain).accessibilityLabel("Toggle \(master.name)").accessibilityIdentifier("toggle-\(master.rawValue)")
                Button(action: open) {
                    HStack {
                        Text(master.name).font(.system(size: 24, weight: .semibold))
                        Spacer()
                        if store.pending.contains(master.rawValue) { ProgressView() }
                        Text(on ? "On" : "Off").font(.system(size: 18)).opacity(0.6)
                    }
                }.buttonStyle(.plain).accessibilityLabel("Open \(master.name)")
            }
            HStack(spacing: 12) {
                ForEach(members) { member in
                    Button { store.send(.toggle(member)) } label: {
                        HStack(spacing: 8) {
                            Image(systemName: member.symbol).font(.system(size: 20))
                            Text(member.name).font(.system(size: 16, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.8)
                        }.frame(maxWidth: .infinity, minHeight: 54)
                            .background(store.lamps.isOn(member) ? .white.opacity(0.6) : .black.opacity(0.09), in: .rect(cornerRadius: 19))
                            .opacity(store.pending.contains(member.rawValue) ? 0.5 : 1)
                    }.buttonStyle(.plain).accessibilityLabel("Toggle \(member.name)").accessibilityValue(store.lamps.isOn(member) ? "On" : "Off").accessibilityIdentifier("toggle-\(member.rawValue)")
                }
            }
        }.padding(24).foregroundStyle(on ? Palette.ink : .white)
    }
}
#Preview("Home · 1366 × 1024", traits: .fixedLayout(width: 1366, height: 1024)) { HomeView(store: MockHomeDataSource()) }
