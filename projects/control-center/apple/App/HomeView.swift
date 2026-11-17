import PanelKit
import SwiftUI
import UIKit

enum HomeTile: String, CaseIterable, Identifiable {
    case climate, clock, wifi, bedroom, livingRoom, ceiling, cabinet, fan, all
    // Existing controllers stay available by launch argument for later faces.
    case lamps, lights, weather, hourly, sound, alarm, tesla, calendar, sonosRooms, photos
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
}
struct HomeView: View {
    let store: any HomeDataSource
    @Environment(\.homeIntegration) private var integration
    @Environment(NotificationCenter.self) private var notifications: NotificationCenter?
    var initialTile: HomeTile?
    var demo = false
    var initialFace = 0
    var onWake: () -> Void = {}
    @State private var shell = PanelShellState()
    @State private var timer: PanelTimerStore
    @State private var brightnessPreview = PanelBrightnessPreview()
    private let runsTimer: Bool
    private var display = PanelDisplayPreferences()
    @AppStorage("panel.clockFace") private var clockFace = PanelClockFace.green
    @GestureState private var faceDrag: CGFloat = 0
    @State private var faceSettle: FaceSettle?

    private struct FaceSettle {
        let step: Int
        var offset: CGFloat
    }
    private var keepsAwake: Bool { timer.keepsScreenAwake }
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.motionPhase) private var inheritedMotionPhase
    @Namespace private var zoom
    @State private var showingSplash = true
    @State private var splashShownAt = ContinuousClock.now
    @State private var displayCornerRadius: CGFloat = 0
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
            // Render-only transforms keep the concentric clip resolved at the
            // resting full-display frame, so swiping faces keep the display corners.
            .visualEffect { content, _ in
                content.scaleEffect(1 - progress * 0.12).offset(x: offset)
            }

        if faceSettle != nil || offset != 0 {
            clockDial(adjacentFace(by: step))
                .visualEffect { content, _ in
                    content.scaleEffect(0.88 + progress * 0.12).offset(x: offset + CGFloat(step) * distance)
                }
        }
    }

    private func clockDial(_ face: PanelClockFace) -> some View {
        PresenceClockFace(store: store, face: face, countdown: timer.countdown)
            // Freeze the clock while it is covered (launcher/app) or moving (face swipe).
            .environment(\.motionPhase, clockIsStill ? inheritedMotionPhase : 0)
            .clipShape(DisplayCorners.shape(displayCornerRadius))
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    private var clockIsStill: Bool {
        selected == nil && showingClock && faceSettle == nil && faceDrag == 0
    }

    /// The splash stays up at least this long, even when the first weather response is quicker.
    private static let minimumSplash: Duration = .seconds(1)

    private func dismissSplash() {
        guard showingSplash else { return }
        let remaining = Self.minimumSplash - splashShownAt.duration(to: .now)
        Task { @MainActor in
            if remaining > .zero { try? await Task.sleep(for: remaining) }
            guard showingSplash else { return }
            withAnimation(.easeOut(duration: 0.35)) { showingSplash = false }
        }
    }

    private func home() {
        if let selected {
            PanelEventLog.shared.record(category: "navigation", action: "app.\(selected.id).close_requested")
        }
        PanelEventLog.shared.record(category: "navigation", action: "launcher.open")
        withAnimation(selected == nil ? .spring(duration: 0.3, bounce: 0) : .smooth(duration: 0.4)) {
            shell.showLauncher()
        }
    }
    private func clock() {
        PanelEventLog.shared.record(category: "navigation", action: "clock.open")
        withAnimation(.spring(duration: 0.3, bounce: 0)) { shell.showClock() }
    }
    private var appPath: Binding<[String]> {
        Binding(
            get: { selected.map { [$0.id] } ?? [] },
            set: { path in
                if let id = path.last {
                    _ = shell.open(id, catalog: catalog)
                } else if selected != nil {
                    // A system pop returns to Apps, but must not overwrite an
                    // explicit idle return to the clock (also an empty path).
                    shell.showLauncher()
                }
            })
    }
    var body: some View {
        NavigationStack(path: appPath) {
            PanelCanvas { size in
                ZStack {
                    Color.black.ignoresSafeArea()
                    ZStack {
                        clockSurface(width: size.width)
                            .frame(width: size.width, height: size.height)
                        if showingClock {
                            // A tap recognizer cancels on movement; a full-screen Button
                            // can activate after a drag that ends inside its large bounds.
                            Color.clear.contentShape(.rect)
                                .onTapGesture(perform: home)
                                .gesture(faceDragGesture(width: size.width))
                                .accessibilityAdjustableAction { direction in
                                    if direction == .increment { settleFace(by: 1, width: size.width) }
                                    if direction == .decrement { settleFace(by: -1, width: size.width) }
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
                            LauncherGlassSurface(displayCornerRadius: displayCornerRadius)
                        }
                        .clipShape(DisplayCorners.shape(displayCornerRadius))
                        .frame(width: size.width, height: size.height)
                        // Render-only slide keeps the concentric corners resolved at rest.
                        .visualEffect { content, _ in content.offset(y: showingClock ? size.height : 0) }
                        .allowsHitTesting(shell.launcherCanReceiveInput)
                        .accessibilityHidden(!shell.launcherCanReceiveInput)
                    }
                }.frame(width: size.width, height: size.height).clipped()
                    .environment(\.colorScheme, .dark).foregroundStyle(.white).tint(.white)
            }
            .toolbar(.hidden, for: .navigationBar)
            .navigationDestination(for: String.self) { id in
                if let app = catalog.app(id: id) {
                    PanelCanvas { size in
                        appScreen(app)
                            .frame(width: size.width, height: size.height)
                    }
                    .toolbar(.hidden, for: .navigationBar)
                    .navigationTransition(.zoom(sourceID: app.id, in: zoom))
                    .onDisappear {
                        if shell.appDestinationDisappeared(id) {
                            PanelEventLog.shared.record(
                                category: "navigation", action: "app.\(id).disappearance_recovered")
                        }
                    }
                }
            }
        }
        .background(DisplayCorners.Reader(radius: $displayCornerRadius))
        .background {
            // Release builds only (TestFlight/App Store); local Debug builds stay unmarked.
            #if !DEBUG
                CautionTapeWindow(cornerRadius: displayCornerRadius)
            #endif
        }
        .overlay {
            if showingSplash {
                PanelSplash().transition(.opacity)
            }
        }
        // Hold the splash until the first weather response decides the day/night face.
        .onChange(of: store.status(for: .weather) == .loading, initial: true) { _, loading in
            if !loading { dismissSplash() }
        }
        .task {
            try? await Task.sleep(for: .seconds(3))
            dismissSplash()
        }
        .onChange(of: PanelSettingsRoute.shared.diagnosticsRequested, initial: true) { _, requested in
            // Settings consumes the request once it is on screen.
            guard requested, selected?.route != .settings, let app = catalog.app(id: "settings") else { return }
            open(app)
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
                if let index = arguments.firstIndex(of: "-previewApp"),
                    arguments.indices.contains(index + 1),
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
                    if case .feature(let feature) = definition.route {
                        return feature.homeTile == initialTile
                    }
                    return false
                })
            {
                open(app)
            }
        }
        .environment(\.colorScheme, .dark).foregroundStyle(.white).tint(.white)
        .onChange(of: selected?.id, initial: true) { oldID, id in
            if let oldID, id == nil {
                PanelEventLog.shared.record(category: "navigation", action: "app.\(oldID).closed")
            }
            if let id {
                PanelEventLog.shared.record(category: "navigation", action: "app.\(id).shown")
            }
            notifications?.setVisibleSources(PanelNotifications.sources(for: id))
        }
        .modifier(
            PanelIdleDimming(
                onIdle: clock, timeout: display.returnToClockSeconds, inhibited: keepsAwake, onWake: onWake)
        )
        .environment(brightnessPreview)
        #if targetEnvironment(simulator)
            .background {
                Button("Open apps") { if showingClock || selected != nil { home() } else { clock() } }
                .keyboardShortcut(.escape, modifiers: [])
                .frame(width: 0, height: 0).opacity(0).accessibilityHidden(true)
            }
        #endif
    }
    private func open(_ app: PanelAppDefinition) {
        PanelEventLog.shared.record(category: "navigation", action: "app.\(app.id).open")
        if app.route == .clock {
            clock()
            return
        }
        withAnimation(.smooth(duration: 0.4)) {
            _ = shell.open(app.id, catalog: catalog)
        }
    }
    private func appScreen(_ app: PanelAppDefinition) -> some View {
        AppCanvasPage(fullBleed: app.route == .feature(.climate)) {
            appContent(app)
        }
    }
    private func appContent(_ app: PanelAppDefinition) -> some View {
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
                    PanelAppBackButton(back: home, respectsCanvasInsets: app.route == .feature(.climate))
                        // Same spot as every other app's close button.
                        .padding(.horizontal, 24)
                        .padding(.top, 16)
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
        case .calendar: CalendarPage(provider: store.calendar, now: store.now)
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
        case .car: .tesla
        case .wifi: .wifi
        }
    }
}
/// Pager order. The clock is the first face (WWW-68).
enum HomeFacePage {
    static let clock = 0, home = 1
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

/// Shown on launch until the first weather response picks the day or night clock face.
/// The studio art is shared with the game's splash (ai-game `tools/gen_studio.mjs`): a 41 px,
/// 8-frame looping globe strip and a 7 px wordmark, drawn at a whole number of points per pixel.
private struct PanelSplash: View {
    private static let pixel: CGFloat = 6

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            VStack(spacing: 4 * Self.pixel) {
                SplashGlobe().frame(width: 41 * Self.pixel, height: 41 * Self.pixel)
                Image("StudioWord")
                    .interpolation(.none)
                    .resizable()
                    .frame(width: 61 * Self.pixel, height: 7 * Self.pixel)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("World Wide Webb, loading")
    }
}

/// The pixel wireframe globe, stepping through its looping 8-frame strip at 8 fps.
private struct SplashGlobe: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private static let start = Date()
    private static let frames: [Image] = {
        guard let strip = UIImage(named: "StudioGlobe")?.cgImage else { return [] }
        let side = strip.height
        return (0..<strip.width / side).compactMap { index in
            strip.cropping(to: CGRect(x: index * side, y: 0, width: side, height: side))
                .map { Image(decorative: $0, scale: 1) }
        }
    }()

    var body: some View {
        TimelineView(.periodic(from: Self.start, by: 1.0 / 8)) { context in
            let tick = Int(context.date.timeIntervalSince(Self.start) * 8)
            if let frame = Self.frames.isEmpty ? nil : Self.frames[reduceMotion ? 0 : tick % Self.frames.count] {
                frame.interpolation(.none).resizable()
            }
        }
        .accessibilityHidden(true)
    }
}

/// Moving full-screen surfaces need the display's corner radius as a fixed value:
/// a concentric shape resolves against where the surface draws, so it squares off
/// once the surface slides away from the display corners.
enum DisplayCorners {
    static func shape(_ radius: CGFloat) -> AnyShape {
        radius > 0
            ? AnyShape(RoundedRectangle(cornerRadius: radius, style: .continuous)) : AnyShape(ConcentricRectangle())
    }

    /// Reads the radius of the display that actually hosts the view (Duo has two).
    struct Reader: UIViewRepresentable {
        @Binding var radius: CGFloat
        func makeUIView(context: Context) -> ReaderView {
            let view = ReaderView()
            view.isUserInteractionEnabled = false
            view.onRadius = { value in if radius != value { radius = value } }
            return view
        }
        func updateUIView(_ uiView: ReaderView, context: Context) {}

        final class ReaderView: UIView {
            var onRadius: ((CGFloat) -> Void)?
            override func didMoveToWindow() {
                super.didMoveToWindow()
                let key = "_displayCornerRadius"
                guard let screen = window?.screen, screen.responds(to: NSSelectorFromString(key)),
                    let value = screen.value(forKey: key) as? CGFloat
                else { return }
                onRadius?(value)
            }
        }
    }
}

/// Hosts the caution tape in its own pass-through window above every sheet, alert and
/// notification, on the same display as the panel. The window itself is hidden while Guided
/// Access is on, so the tape cannot outlive a missed SwiftUI update.
private struct CautionTapeWindow: UIViewRepresentable {
    let cornerRadius: CGFloat

    func makeUIView(context: Context) -> Anchor {
        let anchor = Anchor()
        anchor.isUserInteractionEnabled = false
        return anchor
    }
    func updateUIView(_ anchor: Anchor, context: Context) { anchor.update(cornerRadius: cornerRadius) }
    static func dismantleUIView(_ anchor: Anchor, coordinator: ()) { anchor.tearDown() }

    final class Anchor: UIView {
        private var overlay: UIWindow?
        private var host: UIHostingController<CautionTapeBorder>?
        private var cornerRadius: CGFloat = 0
        private var settle: Task<Void, Never>?

        func update(cornerRadius: CGFloat) {
            self.cornerRadius = cornerRadius
            host?.rootView = CautionTapeBorder(cornerRadius: cornerRadius)
        }

        override func didMoveToWindow() {
            super.didMoveToWindow()
            guard let scene = window?.windowScene else { return tearDown() }
            guard overlay?.windowScene !== scene else { return }
            tearDown()
            let host = UIHostingController(rootView: CautionTapeBorder(cornerRadius: cornerRadius))
            host.view.backgroundColor = .clear
            let overlay = UIWindow(windowScene: scene)
            overlay.windowLevel = .alert + 1
            overlay.isUserInteractionEnabled = false
            // Decoration only: keep VoiceOver and UI automation on the panel's own window.
            overlay.accessibilityElementsHidden = true
            host.view.accessibilityElementsHidden = true
            overlay.backgroundColor = .clear
            overlay.rootViewController = host
            overlay.isHidden = UIAccessibility.isGuidedAccessEnabled
            self.overlay = overlay
            self.host = host
            // Starting or ending Guided Access also deactivates and reactivates the app, so
            // activation re-reads the status in case its own notification was missed.
            let center = Foundation.NotificationCenter.default
            for name in [
                UIAccessibility.guidedAccessStatusDidChangeNotification, UIApplication.didBecomeActiveNotification,
            ] {
                center.addObserver(self, selector: #selector(guidedAccessMayHaveChanged), name: name, object: nil)
            }
        }

        func tearDown() {
            Foundation.NotificationCenter.default.removeObserver(self)
            settle?.cancel()
            settle = nil
            overlay?.isHidden = true
            overlay = nil
            host = nil
        }

        @objc private func guidedAccessMayHaveChanged() {
            applyGuidedAccess()
            // The status can still read its old value while the change is being announced.
            settle?.cancel()
            settle = Task { [weak self] in
                try? await Task.sleep(for: .seconds(1))
                guard !Task.isCancelled else { return }
                self?.applyGuidedAccess()
            }
        }

        private func applyGuidedAccess() {
            guard let overlay else { return }
            let hide = UIAccessibility.isGuidedAccessEnabled
            guard overlay.isHidden != hide else { return }
            if hide {
                UIView.animate(withDuration: 0.25) {
                    overlay.alpha = 0
                } completion: { _ in
                    overlay.isHidden = UIAccessibility.isGuidedAccessEnabled
                    overlay.alpha = 1
                }
            } else {
                overlay.alpha = 0
                overlay.isHidden = false
                UIView.animate(withDuration: 0.25) { overlay.alpha = 1 }
            }
        }
    }
}

/// Yellow-and-black hazard stripes around the display edge, shown while Guided Access is off.
private struct CautionTapeBorder: View {
    let cornerRadius: CGFloat
    static let width: CGFloat = 14
    private static let stripe: CGFloat = 16
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var marching = false

    var body: some View {
        GeometryReader { proxy in
            // Drawn once, one period wider; sliding by one period loops seamlessly,
            // so the march is a cheap offset animation rather than per-frame drawing.
            let period = Self.stripe * 2
            Canvas { context, size in
                context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(Color(red: 1, green: 0.8, blue: 0)))
                var x = -size.height
                while x < size.width {
                    var band = Path()
                    band.move(to: CGPoint(x: x, y: size.height))
                    band.addLine(to: CGPoint(x: x + Self.stripe, y: size.height))
                    band.addLine(to: CGPoint(x: x + Self.stripe + size.height, y: 0))
                    band.addLine(to: CGPoint(x: x + size.height, y: 0))
                    band.closeSubpath()
                    context.fill(band, with: .color(.black))
                    x += period
                }
            }
            .frame(width: proxy.size.width + period, height: proxy.size.height)
            .offset(x: marching ? 0 : -period)
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .leading)
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.linear(duration: 0.9).repeatForever(autoreverses: false)) { marching = true }
            }
        }
        .mask {
            // Screen edge outside; a rounded opening inside, so the tape's inner corners curve.
            TapeRing(width: Self.width, innerRadius: max(cornerRadius - Self.width, 28))
                .fill(style: FillStyle(eoFill: true))
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

private struct TapeRing: Shape {
    let width: CGFloat
    let innerRadius: CGFloat
    func path(in rect: CGRect) -> Path {
        var path = Path(rect)
        path.addRoundedRect(
            in: rect.insetBy(dx: width, dy: width), cornerSize: CGSize(width: innerRadius, height: innerRadius),
            style: .continuous)
        return path
    }
}
