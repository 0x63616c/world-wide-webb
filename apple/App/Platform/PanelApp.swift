import PanelKit
import SwiftUI

// Install the delegate before notification responses can arrive on cold launch.
final class PanelAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        PanelTimerAlerts.shared.activate()
        return true
    }
}

@main
struct PanelApp: App {
    @UIApplicationDelegateAdaptor(PanelAppDelegate.self) private var appDelegate
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
            Group {
                if ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil {
                    Color.clear  // Unit-test hosting must not start provider networking.
                } else {
                    #if DEBUG
                        if NotificationCapture.state != nil {
                            NotificationCapture()
                        } else {
                            PanelRoot().environment(\.motionPhase, fixtureMotionPhase)
                        }
                    #else
                        PanelRoot().environment(\.motionPhase, fixtureMotionPhase)
                    #endif
                }
            }

        }
    }
}

struct PanelRoot: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var session: PanelSession
    @State private var updateChecker: UpdateChecker
    @State private var notifications: NotificationCenter
    @State private var store: LiveHomeDataSource
    @State private var navigation = PanelNavigation()
    @State private var timer = PanelTimerStore()

    init() {
        let center = PanelNotifications.make()
        _notifications = State(initialValue: center)
        _updateChecker = State(
            initialValue: UpdateChecker.live(configuration: PanelConfiguration(), notifications: center))
        #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-hybridFixtures") {
                // Fixture transport keeps launch tests off the live server.
                let config = PanelConfiguration(
                    environment: [
                        "PANEL_SERVER_URL": "http://localhost:1"
                    ])
                _session = State(
                    initialValue: PanelSession(
                        configuration: config,
                        nativeAlarms: NativeAlarmsRuntime(scheduler: FixtureAlarmScheduler())))
                let root = Bundle.main.resourceURL!.appendingPathComponent("Fixtures")
                let ringing = ProcessInfo.processInfo.arguments.contains("-hybridAlarmRinging")
                let fixtureNow: () -> Date
                if ringing {
                    fixtureNow = { AlarmDate.parse("2099-01-01T07:00:01Z")! }
                } else {
                    fixtureNow = { HybridCalendarFixtureStore.now }
                }
                let boothCapture: (@MainActor () async throws -> Data)?
                if ProcessInfo.processInfo.arguments.contains("-hybridBoothCamera") {
                    let camera = BoothCaptureFixture()
                    boothCapture = { try camera.photo() }
                } else {
                    boothCapture = nil
                }
                let transport = HybridFixtureTransport(
                    root: root,
                    unavailable: ProcessInfo.processInfo.arguments.contains("-hybridUnavailable"),
                    alarmScenario: ringing ? "ringing" : "scheduled",
                    walkActive: ProcessInfo.processInfo.arguments.contains("-hybridWalkActive"),
                    sonosPlayback: ProcessInfo.processInfo.arguments.contains("-hybridSonosPlayback"),
                    climateOff: ProcessInfo.processInfo.arguments.contains("-hybridClimateOff"),
                    controlWrites: ProcessInfo.processInfo.arguments.contains("-hybridControlWrites"),
                    fanOffSupported: ProcessInfo.processInfo.arguments.contains("-hybridFanOffSupported"))
                _store = State(
                    initialValue: LiveHomeDataSource(
                        configuration: PanelKit.PanelConfiguration(
                            baseURL: URL(string: "http://localhost:18733")!),
                        transport: transport,
                        calendarAPI: CalendarAPI(
                            store: HybridCalendarFixtureStore(
                                root: root,
                                unavailable: ProcessInfo.processInfo.arguments.contains("-hybridUnavailable")),
                            selection: CalendarSelection(suiteName: "Panel.CalendarFixtures")),
                        now: fixtureNow, calendar: { HybridCalendarFixtureStore.calendar }, boothCapture: boothCapture,
                        boothPreview: BoothReviewFixture.preview(root: root)))
                return
            }
        #endif
        let config = PanelConfiguration()
        _session = State(initialValue: PanelSession(configuration: config))
        _store = State(initialValue: LiveHomeDataSource(configuration: config.api, sonosLockDefaults: .standard))
    }

    private func hasLiveData(for module: PanelModule) -> Bool {
        store.hasLiveData(for: module) && (module != .alarms || session.nativeAlarms.ownsRinging)
    }

    private var homeVisible: Bool { navigation.showingHome }
    private var nativeVisible: Bool { !homeVisible }

    var body: some View {
        ZStack {
            if homeVisible {
                PanelHome(store: store, session: session, navigation: navigation, timer: timer)
            }
            VStack(spacing: 0) {
                if nativeVisible {
                    HStack(spacing: 18) {
                        PanelHomeButton(action: navigation.returnHome)
                        Spacer()
                        Button(navigation.detail ? "Tile" : "Details") { navigation.detail.toggle() }
                            .buttonStyle(.glass).accessibilityIdentifier("module-detail")
                    }.padding(16).foregroundStyle(.white)
                        .environment(\.colorScheme, .dark)
                }
                if nativeVisible {
                    if hasLiveData(for: navigation.selection) {
                        HybridNativeModule(
                            module: navigation.selection, store: store, detail: navigation.detail,
                            open: { navigation.detail = true }, close: { navigation.detail = false })
                    } else {
                        ModuleStatusFace(
                            title: navigation.selection.title,
                            status: store.status(for: HomeModule(rawValue: navigation.selection.rawValue) ?? .lights)
                        )
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }
            }
            .allowsHitTesting(nativeVisible)
            .accessibilityHidden(!nativeVisible)
        }
        .background(Color.black)
        .background { PanelWindowAttachment().allowsHitTesting(false) }
        .background { PanelDiagnosticsAccess(store: store).allowsHitTesting(false) }
        .onReceive(
            Foundation.NotificationCenter.default.publisher(for: PanelCommandLog.failureNotification).receive(
                on: RunLoop.main)
        ) { _ in
            notifications.post(
                sourceModule: "panel", title: "Command failed",
                body: "The action could not be completed. Check the connection and try again.",
                deepLink: "module/all", priority: .high, dedupeKey: "panel-api-command-error")
        }
        .statusBarHidden()
        .defersSystemGestures(on: .bottom)
        .persistentSystemOverlays(ProcessInfo.processInfo.isiOSAppOnMac ? .automatic : .hidden)
        .onChange(of: PanelTimerAlerts.shared.openedTimerID, initial: true) { _, id in
            guard timer.matchesNotification(id) else { return }
            PanelTimerAlerts.shared.clearOpenedTimer()
            Self.openTimer(timer: timer, navigation: navigation)
        }
        .task(id: scenePhase) {
            await timer.run(while: scenePhase) {
                notifications.post(
                    sourceModule: "timer", title: "Time’s up",
                    body: "Your timer has finished.", deepLink: PanelNotifications.timerDeepLink,
                    priority: .high, dedupeKey: "timer-finished")
            }
        }
        .onOpenURL { url in
            guard url.absoluteString == "controlcenter://alarms" else { return }
            navigation.openNativeAlarms()
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            if phase == .active { session.activate() } else { store.stop() }
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            let providers = HomeTile.panelProviders.subtracting([.alarms])
            await store.run(modules: providers)
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
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
                notifications.post(
                    sourceModule: "panel", title: "Action unavailable", body: message,
                    deepLink: "module/all", priority: .high, dedupeKey: "panel-command-error")
            }
        }
        .onChange(of: store.fanProvider.errorRevision) { _, _ in
            if let message = store.fanProvider.errorMessage {
                notifications.post(
                    sourceModule: "fan", title: "Fan action failed", body: message,
                    deepLink: "module/fan", priority: .high, dedupeKey: "fan-command-error")
            }
        }
        .onChange(of: store.alarmsProvider.errorMessage) { _, message in
            if let message {
                notifications.post(
                    sourceModule: "alarms", title: "Alarm action failed", body: message,
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
            notifications.setOpenHandler { [store, session, navigation, timer] item in
                if item.deepLink == PanelNotifications.timerDeepLink {
                    Self.openTimer(timer: timer, navigation: navigation)
                    return true
                }
                return PanelNotifications.open(item, store: store, navigation: navigation)
            }
        }
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            await notifications.run()
        }
        .onDisappear {
            session.stop()
            store.stop()
        }
    }

    private static func openTimer(timer: PanelTimerStore, navigation: PanelNavigation) {
        if !navigation.showingHome { navigation.returnHome() }
        timer.openRequested = true
    }

    private var statusOverlays: some View {
        PanelStatusOverlays(store: store, session: session, navigation: navigation)
    }

}
