import PanelKit
import SwiftUI

enum HomeTile: String, CaseIterable, Identifiable {
    case climate, clock, wifi, bedroom, livingRoom, ceiling, cabinet, fan, all
    // Existing controllers stay available by launch argument for later faces.
    case lamps, lights, weather, hourly, sound, alarm, tesla, calendar, sonosRooms, photos, dogwalk
    static let homeFace: [HomeTile] = [.climate, .lamps, .weather, .tesla, .calendar, .sound, .fan]
    static let controlsFace: [HomeTile] = [.dogwalk, .photos, .sonosRooms, .clock, .ceiling, .cabinet, .wifi, .all]
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
        case .wifi: "Wi-Fi"
        case .weather: "Weather Now"
        case .hourly: "Next 12 Hours"
        case .sound: "Sound System"
        case .alarm: "Next alarm"
        case .tesla: "Tesla"
        case .calendar: "Up Next"
        case .sonosRooms: "Sonos Rooms"
        case .photos: "Photos"
        case .dogwalk: "Dog Walker"
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
        case .climate: (0, 0, 2, 2)
        case .clock: (2, 0, 1, 1)
        case .wifi: (2, 1, 1, 1)
        case .bedroom: (0, 2, 1, 1)
        case .livingRoom: (1, 2, 1, 1)
        case .ceiling: (2, 2, 1, 1)
        case .cabinet: (0, 2, 1, 1)
        case .fan: (1, 2, 1, 1)
        case .all: (2, 2, 1, 1)
        case .weather: (0, 0, 2, 2)
        case .tesla: (2, 0, 1, 1)
        case .sound: (2, 1, 1, 1)
        default: (0, 0, 1, 1)
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
        case .alarm, .tesla, .calendar, .sonosRooms, .photos, .dogwalk: .black
        }
    }
}
struct HomeView: View {
    let store: any HomeDataSource
    @Environment(\.homeIntegration) private var integration
    var initialTile: HomeTile?
    var demo = false
    var initialFace = 0
    var onWake: () -> Void = {}
    @State private var shell = PanelShellState()
    private let launcherMotion = ClockLauncherMotion.current
    @State private var timer: PanelTimerStore
    private let runsTimer: Bool
    private var display = PanelDisplayPreferences()
    @AppStorage("panel.clockFace") private var clockFace = PanelClockFace.green
    @GestureState private var faceDrag: CGFloat = 0
    @State private var faceSettle: FaceSettle?

    private struct FaceSettle {
        let step: Int
        var offset: CGFloat
    }
    private var keepsAwake: Bool { timer.keepsScreenAwake || store.walks.activeWalk != nil }
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.motionPhase) private var inheritedMotionPhase
    @Namespace private var zoom
    private let catalog = PanelAppCatalog.standard
    init(
        store: any HomeDataSource, initialTile: HomeTile? = nil, demo: Bool = false,
        initialFace: Int = 0, managedTimer: PanelTimerStore? = nil, onWake: @escaping () -> Void = {}
    ) {
        self.store = store
        self.initialTile = initialTile
        self.demo = demo
        self.initialFace = initialFace
        _timer = State(initialValue: managedTimer ?? PanelTimerStore())
        runsTimer = managedTimer == nil
        self.onWake = onWake
    }

    private var showingClock: Bool { shell.screen == .clock }
    private var selected: PanelAppDefinition? {
        if case .app(let id) = shell.screen { return catalog.app(id: id) }
        return nil
    }
    private func adjacentFace(by step: Int) -> PanelClockFace {
        let faces = PanelClockFace.allCases
        let index = faces.firstIndex(of: clockFace) ?? 0
        return faces[(index + step + faces.count) % faces.count]
    }

    private func settleFace(by step: Int, width: CGFloat, offset: CGFloat = 0, commit: Bool = true) {
        guard faceSettle == nil else { return }
        let next = adjacentFace(by: step)
        faceSettle = FaceSettle(step: step, offset: offset)
        withAnimation(ClockLauncherMotion.swipePop.animation, completionCriteria: .removed) {
            faceSettle?.offset = commit ? -CGFloat(step) * (width + 24) : 0
        } completion: {
            if commit { clockFace = next }
            faceSettle = nil
        }
    }

    private func faceDragGesture(width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 14)
            .updating($faceDrag) { gesture, offset, _ in
                guard faceSettle == nil,
                    abs(gesture.translation.width) > abs(gesture.translation.height)
                else { return }
                offset = min(width, max(-width, gesture.translation.width))
            }
            .onEnded { gesture in
                let movement = gesture.translation
                guard abs(movement.width) > abs(movement.height) else {
                    if movement.height < -60 || gesture.predictedEndTranslation.height < -150 { home() }
                    return
                }
                let projected = gesture.predictedEndTranslation.width
                let step = movement.width < 0 ? 1 : -1
                let commit = abs(movement.width) >= width * 0.18 || -CGFloat(step) * projected >= width * 0.24
                settleFace(
                    by: step, width: width,
                    offset: min(width, max(-width, movement.width)), commit: commit)
            }
    }

    @ViewBuilder private func clockSurface(width: CGFloat) -> some View {
        let offset = faceSettle?.offset ?? faceDrag
        let step = faceSettle?.step ?? (offset < 0 ? 1 : -1)
        let distance = width + 24
        let progress = min(1, abs(offset) / max(1, distance))

        clockDial(clockFace)
            .id(clockFace)
            .transition(.identity)
            .scaleEffect(1 - progress * 0.12)
            .offset(x: offset)

        if faceSettle != nil || offset != 0 {
            clockDial(adjacentFace(by: step))
                .scaleEffect(0.88 + progress * 0.12)
                .offset(x: offset + CGFloat(step) * distance)
        }
    }

    private func clockDial(_ face: PanelClockFace) -> some View {
        PresenceClockFace(store: store, face: face)
            .environment(\.motionPhase, selected == nil && showingClock ? inheritedMotionPhase : 0)
            .clipShape(.rect(cornerRadius: PanelSurface.cornerRadius))
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    private func home() {
        withAnimation(.spring(duration: 0.3, bounce: 0)) { shell.showLauncher() }
    }
    private func clock() {
        withAnimation(.spring(duration: 0.3, bounce: 0)) { shell.showClock() }
    }
    var body: some View {
        GeometryReader { proxy in
            ZStack {
                Color.black.ignoresSafeArea()
                ZStack {
                    clockSurface(width: proxy.size.width)
                    if showingClock {
                        // A tap recognizer cancels on movement; a full-screen Button
                        // can activate after a drag that ends inside its large bounds.
                        Color.clear.contentShape(.rect)
                            .onTapGesture(perform: home)
                            .gesture(faceDragGesture(width: proxy.size.width))
                            .accessibilityAdjustableAction { direction in
                                if direction == .increment { settleFace(by: 1, width: proxy.size.width) }
                                if direction == .decrement { settleFace(by: -1, width: proxy.size.width) }
                            }
                            .accessibilityElement()
                            .accessibilityLabel("Open apps")
                            .accessibilityValue(clockFace.rawValue.capitalized)
                            .accessibilityAddTraits(.isButton)
                            .accessibilityAction { home() }
                            .accessibilityIdentifier("launcher-clock")
                    }
                    AppLauncher(
                        apps: catalog.apps, open: open, close: clock, isPresented: !showingClock && selected == nil,
                        namespace: zoom
                    )
                    .environment(\.motionPhase, selected == nil && !showingClock ? nil : 0)
                    .background {
                        LauncherGlassSurface()
                    }
                    .clipShape(.rect(cornerRadius: PanelSurface.cornerRadius))
                    .offset(y: showingClock ? proxy.size.height : 0)
                    .allowsHitTesting(!showingClock && selected == nil)
                    .accessibilityHidden(showingClock || selected != nil)
                }
                .modifier(
                    LauncherSurfaceMotion(
                        motion: launcherMotion,
                        progress: selected == nil ? 0 : 1, width: proxy.size.width,
                        incoming: false))
                if let selected {
                    appScreen(selected)
                        .clipShape(.rect(cornerRadius: PanelSurface.cornerRadius))
                        .transition(launcherMotion.incomingTransition(width: proxy.size.width))
                        .zIndex(2)
                }
            }.frame(width: proxy.size.width, height: proxy.size.height).clipped()
                .environment(\.colorScheme, .dark).foregroundStyle(.white).tint(.white)
                .onOpenURL { url in if url.host == "dogwalk", let app = catalog.app(id: "walks") { open(app) } }
                .onChange(of: store.walks.activeWalk, initial: true) { _, walk in
                    store.walkActivity.synchronize(walk: walk, now: store.now)
                }
                .onChange(of: timer.openRequested, initial: true) { _, requested in
                    guard requested, let app = catalog.app(id: "timer") else { return }
                    timer.openRequested = false
                    open(app)
                }
                .task(id: scenePhase) {
                    if runsTimer { await timer.run(while: scenePhase) }
                }
                .task {
                    #if DEBUG
                        let arguments = ProcessInfo.processInfo.arguments
                        if let index = arguments.firstIndex(of: "-previewApp"), arguments.indices.contains(index + 1),
                            let app = catalog.app(id: arguments[index + 1])
                        {
                            open(app)
                            return
                        }
                    #endif
                    guard selected == nil else { return }
                    if initialFace != HomeFacePage.clock { shell.showLauncher() }
                    if let initialTile,
                        let app = catalog.apps.first(where: { definition in
                            if case .feature(let feature) = definition.route { return feature.homeTile == initialTile }
                            return false
                        })
                    {
                        open(app)
                    }
                }
        }.modifier(
            PanelIdleDimming(
                onIdle: clock, timeout: display.returnToClockSeconds, inhibited: keepsAwake, onWake: onWake)
        )
        .ignoresSafeArea(.container)
        #if targetEnvironment(simulator)
            .background {
                Button("Open apps") { if showingClock || selected != nil { home() } else { clock() } }
                .keyboardShortcut(.escape, modifiers: [])
                .frame(width: 0, height: 0).opacity(0).accessibilityHidden(true)
            }
        #endif
    }
    private func open(_ app: PanelAppDefinition) {
        if app.route == .clock {
            clock()
            return
        }
        withAnimation(launcherMotion.animation) {
            _ = shell.open(app.id, catalog: catalog)
        }
    }
    private func appScreen(_ app: PanelAppDefinition) -> some View {
        VStack(spacing: 0) {
            Group {
                switch app.route {
                case .settings: PanelSettingsPage(back: home)
                case .timer: PanelTimerPage(timer: timer)
                case .photoBooth:
                    if let booth = integration?.photoBooth(close: home) {
                        booth
                    } else {
                        VStack {
                            ContentUnavailableView("Photo Booth requires the panel app", systemImage: "camera")
                        }
                        .safeAreaInset(edge: .top, spacing: 0) { PanelAppNavigationBar(back: home) }
                    }
                case .clock: EmptyView()
                case .feature(let feature):
                    if let integration {
                        integration.destination(feature.homeTile, close: home)
                    } else {
                        prototypeScreen(feature)
                    }
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("app-screen-\(app.id)")
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
            .safeAreaInset(edge: .top, spacing: 0) {
                if app.route != .timer && app.route != .photoBooth && app.route != .settings
                    && app.route != .feature(.climate)
                {
                    PanelAppNavigationBar(back: home)
                }
            }
            .overlay(alignment: .topTrailing) {
                if app.route == .timer || app.route == .feature(.climate) {
                    // The timer’s angled marks extend inward around the corner.
                    PanelAppBackButton(back: home)
                        .padding(.horizontal, app.route == .timer ? 40 : 24)
                        .padding(.top, app.route == .timer ? 32 : 16)
                }
            }
            .scrollBounceBehavior(.basedOnSize)
            .background(Color.black)
            .accessibilityAction(.escape) { home() }
            .accessibilityAction(named: "Open apps") { home() }
            .environment(\.motionPhase, inheritedMotionPhase)
            .onKeyPress(.escape) {
                home()
                return .handled
            }
    }
    @ViewBuilder private func prototypeScreen(_ feature: PanelAppFeature) -> some View {
        switch feature {
        case .lights: ControlsController(store: store)
        case .climate: ClimateController(store: store)
        case .music: SonosRoomsPage(store: store)
        case .weather: WeatherPage(weather: store.weather)
        case .calendar: AgendaPage(provider: store.calendar, now: store.now)
        case .walks: DogWalkPage(store: store)
        case .wifi: WifiController(wifi: store.wifi)
        case .car: TeslaController(provider: store.tesla)
        }
    }
}

extension PanelAppFeature {
    var homeTile: HomeTile {
        switch self {
        case .lights: .lights
        case .climate: .climate
        case .music: .sound
        case .weather: .weather
        case .calendar: .calendar
        case .walks: .dogwalk
        case .car: .tesla
        case .wifi: .wifi
        }
    }
}
/// Pager order. The clock is the first face (WWW-68).
enum HomeFacePage {
    static let clock = 0, home = 1, controls = 2, music = 3
    static let names = ["clock", "home", "controls", "music"]
    static let labels = ["Clock face", "Home face", "Home more face", "Music face"]
}
struct PhoneFaceBar: View {
    @Binding var selection: Int
    var body: some View {
        VStack(spacing: 6) {
            FacePicker(selection: $selection)
                .frame(width: 200, height: 56)
                .glassEffect(.regular, in: .capsule)
            Text("Fixture data").font(.system(size: 10)).foregroundStyle(.secondary)
        }.frame(height: HomeFaceLayout.phonePagerBand)
    }
}
// Shared by the live pager and the fast snapshot target; no duplicate visual layout.
struct FacePicker: View {
    @Environment(\.homeIntegration) private var integration
    @Binding var selection: Int
    @Environment(\.horizontalSizeClass) private var sizeClass
    var body: some View {
        HStack(spacing: sizeClass == .compact ? 4 : 10) {
            ForEach(0..<4) { page in
                Button {
                    withAnimation(.easeInOut(duration: 0.25)) { selection = page }
                } label: {
                    Circle().fill(.white.opacity(selection == page ? 0.95 : 0.3))
                        .frame(width: 8, height: 8).frame(width: 44, height: 44)
                        .contentShape(.rect)
                }.buttonStyle(.plain)
                    .accessibilityLabel(HomeFacePage.labels[page])
                    .accessibilityValue(selection == page ? "Selected" : "")
                    .accessibilityIdentifier("face-page-\(page)")
            }
        }
        .overlay(alignment: .trailing) {
            if sizeClass != .compact {
                Text(integration?.caption ?? "Fixture data").font(.system(size: 11)).foregroundStyle(.secondary)
                    .fixedSize().offset(x: 110).allowsHitTesting(false)
            }
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
    var faceSelection: Binding<Int> = .constant(0)
    @Environment(\.horizontalSizeClass) private var sizeClass
    var body: some View {
        if sizeClass == .compact {
            CompactFace(store: store, controls: controls, zoom: zoom, open: open, faceSelection: faceSelection)
        } else {
            GeometryReader { _ in
                GlassEffectContainer(spacing: 12) {
                    HomeFaceGrid(
                        store: store, size: size, controls: controls, selected: selected, zoom: zoom, open: open)
                }
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
        if HomeGrid.enabled {
            GridHomeFace(store: store, size: size, page: controls ? 1 : 0, open: open, zoom: zoom)
        } else {
            legacy
        }
    }
    private var legacy: some View {
        let layout = HomeFaceLayout.panel(in: size, controls: controls)
        return ZStack(alignment: .topLeading) {
            HStack {
                Text(controls ? "Home · More" : "Home").font(.system(size: 40, weight: .bold))
                Spacer()
                Text(fixtureTime(store.now, format: "EEEE, MMMM d")).font(.system(size: 22, weight: .medium))
            }.frame(width: layout.header.width, height: layout.header.height)
                .position(x: layout.header.midX, y: layout.header.midY)
            ForEach(layout.items) { item in
                MixedHomeTile(tile: item.tile, store: store, open: { open(item.tile) })
                    .frame(width: item.frame.width, height: item.frame.height)
                    .modifier(
                        MixedTileMaterial(
                            round: item.round, on: tileOn(item.tile),
                            imageContent: [.weather, .photos].contains(item.tile))
                    )
                    .glassEffectID("\(controls)-\(item.id)", in: zoom)
                    .matchedTransitionSource(id: "\(controls ? 1 : 0)-\(item.id)", in: zoom)
                    .position(x: item.frame.midX, y: item.frame.midY)
            }
        }.frame(width: size.width, height: size.height)
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
    @Environment(\.motionPhase) private var motionPhase
    var body: some View {
        if let key = tile.accessory {
            AccessoryFace(key: key, store: store, open: open)
        } else {
            switch tile {
            case .climate: climate
            case .clock:
                TimelineView(.animation(minimumInterval: 1.0 / 30, paused: motionPhase != nil)) { _ in
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
                Text(
                    store.climate.mode == .off
                        ? "Off"
                        : store.climate.mode == .heatCool
                            ? "\(store.climate.low)–\(store.climate.high)" : "\(store.climate.target)"
                )
                .font(
                    .system(size: proxy.size.height * (store.climate.mode == .heatCool ? 0.29 : 0.46), weight: .regular)
                )
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

        }
    }
    private func setpointButton(_ symbol: String, label: String, delta: Int) -> some View {
        Button {
            step(delta)
        } label: {
            Image(systemName: symbol).font(.system(size: 62, weight: .semibold))
                .frame(width: 92, height: 92).contentShape(Circle())
        }.buttonStyle(.plain)
            .disabled(store.climate.mode == .off)
            .accessibilityLabel(label)
            .accessibilityIdentifier(delta < 0 ? "tile-climate-down" : "tile-climate-up")
    }
    private func step(_ delta: Int) {
        withAnimation(.smooth(duration: 0.25)) {
            store.send(store.climate.mode == .heatCool ? .shiftRange(delta) : .target(store.climate.target + delta))
        }
    }
}
struct AccessoryFace: View {
    let key: Accessory
    let store: any HomeDataSource
    let open: () -> Void
    var fanIsOn: Bool? = nil
    var on: Bool {
        key == .fan ? (fanIsOn ?? (store.climate.fanOn && store.climate.mode != .off)) : store.lamps.isOn(key)
    }
    var title: String {
        key == .bedroom ? "Bedroom" : key == .livingRoom ? "Living Room" : key == .ceiling ? "Ceiling" : key.name
    }
    var subtitle: String {
        switch key {
        case .all: on ? "All lights on" : "Some lights off"
        case .fan: "A/C · \(store.climate.fanLabel)"
        case .lamps, .lights: on ? "On" : "Off"
        case .bedroom: "\(store.lamps.onCount(.bedroom)) lamps on"
        case .livingRoom: store.lamps.isOn(.livingRoom) ? "\(store.lamps.onCount(.livingRoom)) lamps on" : "Lamps off"
        case .ceiling: on ? "Lights on" : "Lights off"
        case .cabinet: on ? "Kitchen · On" : "Kitchen · Off"
        }
    }
    var body: some View {
        VStack(spacing: 0) {
            Button {
                store.send(.toggle(key))
            } label: {
                Group {
                    if key == .fan {
                        FanSymbol(on: on)
                    } else {
                        Image(systemName: key.symbol).symbolRenderingMode(.hierarchical)
                    }
                }.font(.system(size: 64, weight: .regular))
                    .foregroundStyle(on ? Color.orange : .white)
                    .frame(width: 120, height: 100)
                    .background {
                        if key != .fan {
                            LampGlow(on: on, brightness: store.lamps.brightness).frame(width: 200, height: 180)
                                .allowsHitTesting(false)
                        }
                    }
            }.buttonStyle(.plain).padding(.bottom, 20)
                .accessibilityLabel("Toggle \(key.name)").accessibilityValue(
                    key == .fan ? store.climate.fanLabel : on ? "On" : "Off"
                ).accessibilityIdentifier("toggle-\(key.rawValue)")
            Button(action: open) {
                VStack(spacing: 7) {
                    Text(title).font(.system(size: key == .cabinet ? 30 : 32, weight: .semibold)).lineLimit(1)
                    Text(subtitle).font(.system(size: 24)).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity)
            }.buttonStyle(.plain).accessibilityLabel("Open \(key.name)")
        }.foregroundStyle(on ? Color.black : Color.white).frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
#Preview("Home face · 1376 × 1032", traits: .fixedLayout(width: 1376, height: 1032)) {
    HomeView(store: MockHomeDataSource())
}
