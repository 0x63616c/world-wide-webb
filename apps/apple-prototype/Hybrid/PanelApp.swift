import SwiftUI
import PanelKit

@main
struct PanelApp: App {
    private var fixtureMotionPhase: Double? {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        return arguments.contains("-hybridFixtures") && arguments.contains("-hybridStill") ? 0 : nil
        #else
        return nil
        #endif
    }

    var body: some Scene {
        WindowGroup {
            if ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil {
                Color.clear // Unit-test hosting must not start WebKit or provider networking.
            } else {
                #if DEBUG
                if NotificationCapture.state != nil { NotificationCapture() }
                else { PanelRoot().environment(\.motionPhase, fixtureMotionPhase) }
                #else
                PanelRoot().environment(\.motionPhase, fixtureMotionPhase)
                #endif
            }
        }
    }
}

struct PanelRoot: View {
    @Environment(\.scenePhase) private var scenePhase
    // Configuration and flags are intentional launch-time snapshots.
    @State private var session: KioskSession
    @State private var updateChecker: UpdateChecker
    @State private var notifications: NotificationCenter
    @State private var store: LiveHomeDataSource
    @State private var navigation = PanelNavigation()
    private let webOnly: Bool
    private let router: HybridRouter
    private let requested: Set<PanelModule>

    init() {
        let center = PanelNotifications.make()
        _notifications = State(initialValue: center)
        _updateChecker = State(initialValue: UpdateChecker.live(configuration: PanelConfiguration(), notifications: center))
        // Fixture runs keep the all-web default so UI tests opt in per module.
        #if DEBUG
        let shipped: Set<PanelModule> = ProcessInfo.processInfo.arguments.contains("-hybridFixtures")
            ? [] : ModuleFlags.shippedNative
        #else
        let shipped = ModuleFlags.shippedNative
        #endif
        let flags = ModuleFlags(defaults: .standard, nativeByDefault: shipped)
        webOnly = UserDefaults.standard.bool(forKey: ModuleFlags.webOnlyKey)
        router = HybridRouter(flags: flags)
        requested = webOnly ? [] : HomeTile.panelProviders
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
                sonosPlayback: ProcessInfo.processInfo.arguments.contains("-hybridSonosPlayback"),
                climateOff: ProcessInfo.processInfo.arguments.contains("-hybridClimateOff"),
                controlWrites: ProcessInfo.processInfo.arguments.contains("-hybridControlWrites"),
                fanOffSupported: ProcessInfo.processInfo.arguments.contains("-hybridFanOffSupported"))
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

    private var homeVisible: Bool { navigation.showingHome && !webOnly }

    private var nativeVisible: Bool {
        !homeVisible && router.route(for: navigation.selection, hasLiveData: hasLiveData(for: navigation.selection)) == .native(navigation.selection)
    }

    var body: some View {
        @Bindable var session = session
        ZStack {
            webBoard
                .opacity(nativeVisible || homeVisible ? 0 : 1)
                .allowsHitTesting(!nativeVisible && !homeVisible)
                .accessibilityHidden(nativeVisible || homeVisible)
            if homeVisible {
                PanelHome(store: store, session: session, router: router, navigation: navigation)
            }
            VStack(spacing: 0) {
                if !homeVisible && nativeVisible {
                    HStack(spacing: 18) {
                        Button("Home", action: navigation.returnHome).buttonStyle(.glass)
                            .accessibilityIdentifier("module-home")
                        ForEach([PanelModule.all] + nativeModules, id: \.self) { module in
                            Button(module.title) { navigation.pendingNativeAlarmLink = false; navigation.selection = module; navigation.detail = false }
                                .buttonStyle(.glass)
                                .accessibilityIdentifier("module-\(module.rawValue)")
                        }
                        Spacer()
                        if nativeVisible {
                            Button(navigation.detail ? "Tile" : "Details") { navigation.detail.toggle() }
                                .buttonStyle(.glass).accessibilityIdentifier("module-detail")
                        }
                    }.padding(16).foregroundStyle(.white)
                        .environment(\.colorScheme, .dark)
                }
                HybridModuleHost(router: router, module: navigation.selection,
                    liveView: !homeVisible && hasLiveData(for: navigation.selection)
                        ? HybridNativeModule(module: navigation.selection, store: store, detail: navigation.detail, open: { navigation.detail = true }, close: { navigation.detail = false }) : nil) {
                    Color.clear.allowsHitTesting(false)
                }
            }
            .allowsHitTesting(nativeVisible)
            .accessibilityHidden(!nativeVisible)
        }
        .overlay(alignment: .topLeading) {
            if !homeVisible && !nativeVisible && !webOnly {
                ClassicHomeButton(action: { navigation.returnHome() })
            }
        }
        .background(Color(red: 16 / 255, green: 20 / 255, blue: 25 / 255))
        .background { PanelWindowAttachment().allowsHitTesting(false) }
        .background { PanelDiagnosticsAccess(store: store).allowsHitTesting(false) }
        .onReceive(Foundation.NotificationCenter.default.publisher(for: PanelCommandLog.failureNotification).receive(on: RunLoop.main)) { _ in
            notifications.post(sourceModule: "panel", title: "Command failed",
                body: "The action could not be completed. Check the connection and try again.",
                deepLink: "module/all", priority: .high, dedupeKey: "panel-api-command-error")
        }
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
            navigation.showingHome = false
            navigation.pendingNativeAlarmLink = router.flags[.alarms] == .native
            if navigation.pendingNativeAlarmLink && hasLiveData(for: .alarms) { navigation.openNativeAlarms() }
            else { navigation.selection = .all; session.open(url) }
        }
        .onChange(of: hasLiveData(for: .alarms)) { _, ready in
            if ready && navigation.pendingNativeAlarmLink { navigation.openNativeAlarms() }
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
            if router.flags[.alarms] == .native { providers.remove(.alarms) }
            await store.run(modules: providers)
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            if router.flags[.alarms] != .native {
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
        .overlay { statusOverlays }
        .modifier(NotificationHistoryAccess())
        .onChange(of: store.errorRevision) { _, _ in
            if let message = store.errorMessage {
                notifications.post(sourceModule: "panel", title: "Action unavailable", body: message,
                    deepLink: "module/all", priority: .high, dedupeKey: "panel-command-error")
            }
        }
        .onChange(of: store.fanProvider.errorRevision) { _, _ in
            if let message = store.fanProvider.errorMessage {
                notifications.post(sourceModule: "fan", title: "Fan action failed", body: message,
                    deepLink: "module/fan", priority: .high, dedupeKey: "fan-command-error")
            }
        }
        .onChange(of: store.alarmsProvider.errorMessage) { _, message in
            if let message {
                notifications.post(sourceModule: "alarms", title: "Alarm action failed", body: message,
                    deepLink: "module/alarms", priority: .high, dedupeKey: "alarm-command-error")
            }
        }
        .onChange(of: store.alarmsProvider.snapshot?.active) { _, _ in navigation.ringHidden = false }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await updateChecker.run()
        }
        .environment(notifications)
        .onAppear {
            notifications.setOpenHandler { [store, session, navigation, router] item in
                PanelNotifications.open(item, store: store, session: session, navigation: navigation, router: router)
            }
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await notifications.run()
        }
        .onDisappear { session.stop(); store.stop() }
    }

    private var statusOverlays: some View {
        PanelStatusOverlays(store: store, session: session, navigation: navigation)
    }

    private var webBoard: some View {
        PanelClassicBoard(session: session)
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
