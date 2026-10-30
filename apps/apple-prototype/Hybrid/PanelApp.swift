import SwiftUI
import PanelKit

@main
struct PanelApp: App {
    var body: some Scene {
        WindowGroup {
            if ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil {
                Color.clear // Unit-test hosting must not start WebKit or provider networking.
            } else { PanelRoot() }
        }
    }
}

struct PanelRoot: View {
    @Environment(\.scenePhase) private var scenePhase
    // Configuration and flags are intentional launch-time snapshots.
    @State private var session: KioskSession
    @State private var updateChecker: UpdateChecker
    @State private var store: LiveHomeDataSource
    @State private var selection: PanelModule
    @State private var detail: Bool
    @State private var showingHome = true
    @State private var ringHidden = false
    @State private var pendingNativeAlarmLink = false
    private let router: HybridRouter
    private let requested: Set<PanelModule>

    init() {
        _updateChecker = State(initialValue: UpdateChecker.live(configuration: PanelConfiguration()))
        #if DEBUG
        _detail = State(initialValue: ProcessInfo.processInfo.arguments.contains("-hybridDetail"))
        #else
        _detail = State(initialValue: false)
        #endif
        // Fixture runs keep the all-web default so UI tests opt in per module.
        #if DEBUG
        let shipped: Set<PanelModule> = ProcessInfo.processInfo.arguments.contains("-hybridFixtures")
            ? [] : ModuleFlags.shippedNative
        #else
        let shipped = ModuleFlags.shippedNative
        #endif
        let flags = ModuleFlags(defaults: .standard, nativeByDefault: shipped)
        router = HybridRouter(flags: flags)
        requested = Set(PanelModule.allCases.filter { $0 != .all && flags[$0] == .native })
        _selection = State(initialValue: PanelModule.allCases.first { $0 != .all && flags[$0] == .native } ?? .all)
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-hybridFixtures") {
            let defaults = UserDefaults(suiteName: "Panel.FixtureConfiguration")!
            // Fixed loopback for the real web fallback; never contact a server in fixture mode.
            let config = PanelConfiguration(info: [:], defaults: defaults,
                environment: ["PANEL_SERVER_URL": "http://localhost:1", "PANEL_CF_ACCESS_CLIENT_ID": "",
                              "PANEL_CF_ACCESS_CLIENT_SECRET": "", "PANEL_ALARM_API_TOKEN": ""])
            _session = State(initialValue: KioskSession(configuration: config, nativeAlarmsRequested: flags[.alarms] == .native,
                nativeAlarms: NativeAlarmsRuntime(scheduler: FixtureAlarmScheduler())))
            let root = Bundle.main.resourceURL!.appendingPathComponent("Fixtures")
            let ringing = ProcessInfo.processInfo.arguments.contains("-hybridAlarmRinging")
            let fixtureNow: () -> Date
            if ringing { fixtureNow = { AlarmDate.parse("2099-01-01T07:00:01Z")! } }
            else if flags[.calendar] == .native { fixtureNow = { HybridCalendarFixtureStore.now } }
            else { fixtureNow = Date.init }
            let transport = HybridFixtureTransport(root: root,
                unavailable: ProcessInfo.processInfo.arguments.contains("-hybridUnavailable"),
                alarmScenario: ringing ? "ringing" : "scheduled",
                walkActive: ProcessInfo.processInfo.arguments.contains("-hybridWalkActive"),
                sonosPlayback: ProcessInfo.processInfo.arguments.contains("-hybridSonosPlayback"))
            _store = State(initialValue: LiveHomeDataSource(
                configuration: PanelKit.PanelConfiguration(baseURL: URL(string: "http://localhost:18733")!,
                    accessClientID: "synthetic-id", accessClientSecret: "synthetic-secret"),
                transport: transport, remindersAPI: HybridRemindersFixture(
                    unavailable: ProcessInfo.processInfo.arguments.contains("-hybridUnavailable")),
                mediaAPI: HybridMediaFixture(unavailable: ProcessInfo.processInfo.arguments.contains("-hybridUnavailable")),
                calendarAPI: CalendarAPI(store: HybridCalendarFixtureStore(root: root,
                    unavailable: ProcessInfo.processInfo.arguments.contains("-hybridUnavailable"))),
                now: fixtureNow, calendar: { HybridCalendarFixtureStore.calendar }))
            return
        }
        #endif
        let config = PanelConfiguration()
        _session = State(initialValue: KioskSession(configuration: config, nativeAlarmsRequested: flags[.alarms] == .native))
        _store = State(initialValue: LiveHomeDataSource(configuration: PanelKit.PanelConfiguration(
            baseURL: config.serverURL,
            accessClientID: config.accessHeaders["CF-Access-Client-Id"],
            accessClientSecret: config.accessHeaders["CF-Access-Client-Secret"]), sonosLockDefaults: .standard))
    }

    private func hasLiveData(for module: PanelModule) -> Bool {
        store.hasLiveData(for: module) && (module != .alarms || session.nativeAlarms.ownsRinging)
    }

    private var nativeModules: [PanelModule] {
        PanelModule.allCases.filter {
            router.route(for: $0, hasLiveData: hasLiveData(for: $0)) == .native($0)
        }
    }

    private var homeVisible: Bool { showingHome && !requested.isEmpty }

    private var nativeVisible: Bool {
        !homeVisible &&
        router.route(for: selection, hasLiveData: hasLiveData(for: selection)) == .native(selection)
    }

    var body: some View {
        @Bindable var session = session
        ZStack {
            webBoard
                .opacity(nativeVisible || homeVisible ? 0 : 1)
                .allowsHitTesting(!nativeVisible && !homeVisible)
                .accessibilityHidden(nativeVisible || homeVisible)
            if homeVisible {
                HybridHome { module in
                    pendingNativeAlarmLink = false
                    selection = module
                    detail = false
                    showingHome = false
                }
            }
            VStack(spacing: 0) {
                if !homeVisible && nativeVisible {
                    HStack(spacing: 18) {
                        Button("Home", action: returnHome)
                            .buttonStyle(.glass).accessibilityIdentifier("module-home")
                        ForEach(nativeModules, id: \.self) { module in
                            Button(module.title) { pendingNativeAlarmLink = false; selection = module; detail = false }
                                .buttonStyle(.glass)
                                .accessibilityIdentifier("module-\(module.rawValue)")
                        }
                        Spacer()
                        if nativeVisible {
                            Button(detail ? "Tile" : "Details") { detail.toggle() }
                                .buttonStyle(.glass).accessibilityIdentifier("module-detail")
                        }
                    }.padding(16).foregroundStyle(.white)
                        .environment(\.colorScheme, .dark)
                }
                if !homeVisible {
                    HybridModuleHost(router: router, module: selection,
                        liveView: hasLiveData(for: selection)
                            ? HybridNativeModule(module: selection, store: store, detail: detail, open: { detail = true }, close: { detail = false }) : nil) {
                        Color.clear.allowsHitTesting(false)
                    }
                }
            }
            if !homeVisible && !nativeVisible && !requested.isEmpty {
                VStack {
                    HStack { ClassicHomeButton(action: returnHome); Spacer() }
                    Spacer()
                }
            }
        }
        .background(Color(red: 16 / 255, green: 20 / 255, blue: 25 / 255))
        .background { PanelWindowAttachment().allowsHitTesting(false) }
        .statusBarHidden()
        .persistentSystemOverlays(ProcessInfo.processInfo.isiOSAppOnMac ? .automatic : .hidden)
        .sheet(item: $session.browser) { destination in
            PanelBrowser(url: destination.url) { session.browser = nil }
                .id(destination.id)
                .ignoresSafeArea()
        }
        .sheet(item: $session.share) { destination in
            PanelShareSheet(url: destination.url)
        }
        .onOpenURL { url in
            guard url.absoluteString == "controlcenter://alarms" else { return }
            showingHome = false
            pendingNativeAlarmLink = router.flags[.alarms] == .native
            if pendingNativeAlarmLink && hasLiveData(for: .alarms) { openNativeAlarms() }
            else { selection = .all; session.open(url) }
        }
        .onChange(of: hasLiveData(for: .alarms)) { _, ready in
            if ready && pendingNativeAlarmLink { openNativeAlarms() }
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            if phase == .active { session.activate() }
            else { store.stop() }
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            var providers = requested
            // The unchanged Controls and Climate controllers contain a fan control.
            // Read its real data even when the independent Fan route remains web.
            if !providers.isDisjoint(with: [.lights, .climate]) { providers.insert(.fan) }
            providers.remove(.alarms)
            await store.run(modules: providers)
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            if !requested.contains(.alarms) {
                await session.nativeAlarms.release(handoff: { await session.setAlarmOwner($0) })
                return
            }
            while !Task.isCancelled {
                await store.refresh(.alarms)
                if Task.isCancelled { return }
                await session.reconcileAlarms(store.alarmsProvider)
                do { try await Task.sleep(for: .seconds(1)) } catch { return }
            }
        }
        .overlay {
            if !ringHidden, hasLiveData(for: .alarms), !store.alarmsProvider.ringing(at: store.now).isEmpty {
                AlarmRingView(store: store, close: { showingHome = false; ringHidden = true; selection = .alarms; detail = true },
                              edit: { showingHome = false; ringHidden = true; selection = .alarms; detail = true }, dataCaption: "")
                    .disabled(store.alarmsProvider.pending)
            }
        }
        .overlay(alignment: .bottom) {
            if nativeVisible, selection == .alarms, let message = store.alarmsProvider.errorMessage {
                Text(message).padding().background(.regularMaterial).accessibilityAddTraits(.updatesFrequently)
            }
        }
        .onChange(of: store.alarmsProvider.snapshot?.active) { _, _ in ringHidden = false }
        .overlay(alignment: .top) {
            if let build = updateChecker.availableBuild {
                UpdateBanner(build: build).padding(.top, 72).padding(.horizontal, 24)
            }
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await updateChecker.run()
        }
        .onDisappear { session.stop(); store.stop() }
    }

    private func returnHome() {
        pendingNativeAlarmLink = false
        detail = false
        showingHome = true
    }

    private func openNativeAlarms() {
        showingHome = false
        pendingNativeAlarmLink = false
        ringHidden = true
        selection = .alarms
        detail = true
    }

    private var webBoard: some View {
        ZStack {
            Color(red: 16 / 255, green: 20 / 255, blue: 25 / 255)
            KioskWebView(session: session).id(session.generation)
            if session.reconnecting {
                Color(red: 16 / 255, green: 20 / 255, blue: 25 / 255)
                Text("Reconnecting…")
                    .font(.body)
                    .foregroundStyle(.white.opacity(0.7))
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
        .ignoresSafeArea()
        .accessibilityIdentifier("web-board")
        .task(id: session.reconnecting && !nativeVisible) {
            if session.reconnecting && !nativeVisible { await signalSnapshotReady() }
        }
    }
}

/// WWW-11…16 can pass an existing Sources view *only after* a live provider
/// has its data. A nil view always keeps the existing web fallback mounted.
/// The composition owner supplies one board fallback for the remaining modules.
struct HybridModuleHost<NativeContent: View, WebContent: View>: View {
    let router: HybridRouter
    let module: PanelModule
    let liveView: NativeContent?
    @ViewBuilder let webBoard: () -> WebContent

    var body: some View {
        if case .native = router.route(for: module, hasLiveData: liveView != nil), let liveView {
            liveView
        } else {
            webBoard()
        }
    }
}
