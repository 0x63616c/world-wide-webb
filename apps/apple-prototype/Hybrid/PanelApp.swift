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
    @State private var store: LiveHomeDataSource
    @State private var selection: PanelModule
    @State private var detail = false
    private let router: HybridRouter
    private let requested: Set<PanelModule>

    init() {
        let flags = ModuleFlags(defaults: .standard)
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
            _session = State(initialValue: KioskSession(configuration: config))
            let root = Bundle.main.resourceURL!.appendingPathComponent("Fixtures")
            let transport = HybridFixtureTransport(root: root,
                unavailable: ProcessInfo.processInfo.arguments.contains("-hybridUnavailable"))
            _store = State(initialValue: LiveHomeDataSource(
                configuration: PanelKit.PanelConfiguration(baseURL: URL(string: "https://fixtures.example.invalid")!),
                transport: transport))
            return
        }
        #endif
        let config = PanelConfiguration()
        _session = State(initialValue: KioskSession(configuration: config))
        _store = State(initialValue: LiveHomeDataSource(configuration: PanelKit.PanelConfiguration(
            baseURL: config.serverURL,
            accessClientID: config.accessHeaders["CF-Access-Client-Id"],
            accessClientSecret: config.accessHeaders["CF-Access-Client-Secret"])))
    }

    private var nativeModules: [PanelModule] {
        PanelModule.allCases.filter {
            router.route(for: $0, hasLiveData: store.hasLiveData(for: $0)) == .native($0)
        }
    }

    private var nativeVisible: Bool {
        router.route(for: selection, hasLiveData: store.hasLiveData(for: selection)) == .native(selection)
    }

    var body: some View {
        @Bindable var session = session
        ZStack {
            webBoard
                .opacity(nativeVisible ? 0 : 1)
                .allowsHitTesting(!nativeVisible)
                .accessibilityHidden(nativeVisible)
            VStack(spacing: 0) {
                if !nativeModules.isEmpty {
                    HStack(spacing: 18) {
                        ForEach([PanelModule.all] + nativeModules, id: \.self) { module in
                            Button(module.title) { selection = module; detail = false }
                                .buttonStyle(.glass)
                                .accessibilityIdentifier("module-\(module.rawValue)")
                        }
                        Spacer()
                        if nativeVisible {
                            Button(detail ? "Tile" : "Details") { detail.toggle() }
                                .buttonStyle(.glass).accessibilityIdentifier("module-detail")
                        }
                    }.padding(16).foregroundStyle(.white)
                }
                HybridModuleHost(router: router, module: selection,
                    liveView: store.hasLiveData(for: selection)
                        ? HybridNativeModule(module: selection, store: store, detail: detail, open: { detail = true }) : nil) {
                    Color.clear.allowsHitTesting(false)
                }
            }
        }
        .background(Color(red: 16 / 255, green: 20 / 255, blue: 25 / 255))
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
        .sheet(item: $session.browser) { destination in
            PanelBrowser(url: destination.url) { session.browser = nil }
                .id(destination.id)
                .ignoresSafeArea()
        }
        .sheet(item: $session.share) { destination in
            PanelShareSheet(url: destination.url)
        }
        .onOpenURL { selection = .all; session.open($0) }
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
            if providers.contains(.lights) { providers.insert(.climate) }
            await store.run(modules: providers)
        }
        .onDisappear { session.stop(); store.stop() }
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
