import SwiftUI

@main struct WorldWideWebbApp: App {
    @State private var store: MockHomeDataSource
    private let openTile: HomeTile?
    private let demo: Bool
    private let initialFace: Int
    private let presenceNear: Bool
    init() {
        let args = ProcessInfo.processInfo.arguments
        func option(_ key: String) -> String? {
            guard let index = args.firstIndex(of: key), args.indices.contains(index + 1) else { return nil }
            return args[index + 1]
        }
        _store = State(initialValue: MockHomeDataSource(wifiFixture: option("-wifiFixture") ?? "secured", mode: ClimateMode(rawValue: option("-climateMode") ?? "cool") ?? .cool, fixedNow: args.contains("-snapshot") ? FixtureClock.now : nil, ringing: args.contains("-alarmRinging")))
        openTile = HomeTile(rawValue: option("-openTile") ?? "")
        demo = args.contains("-demo")
        initialFace = ["home", "controls", "clock", "music"].firstIndex(of: option("-face") ?? "home") ?? 0
        presenceNear = option("-presence") == "near"
    }
    var body: some Scene {
        WindowGroup {
            Group {
                // Unit tests own their fixtures and snapshot window; avoid
                // mounting a second animated dashboard in the test host.
                if ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil { Color.clear }
                else if ProcessInfo.processInfo.arguments.contains("-walkActivityPreview") { WalkActivityPreviewPage() }
                else { HomeView(store: store, initialTile: openTile, demo: demo, initialFace: initialFace, initialPresence: presenceNear) }
            }
                .task {
                    if openTile == nil { await signalSnapshotReady() }
                }
                #if os(macOS)
                .frame(width: 1376, height: 1032)
                .environment(\.desktopLayout, true)
                #endif
                .preferredColorScheme(.dark)
                .environment(\.motionPhase, ProcessInfo.processInfo.arguments.contains("-snapshot") ? 0 : nil)
                #if os(iOS)
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)
                #endif
        }
        .defaultSize(width: 1376, height: 1032)
        #if os(macOS)
        .windowStyle(.hiddenTitleBar)
        .windowResizability(.contentSize)
        #endif
    }
}

/// Called by the visible face or full-screen destination, never the view covered
/// by a presentation (whose SwiftUI task may be cancelled).
@MainActor func signalSnapshotReady() async {
    guard ProcessInfo.processInfo.arguments.contains("-snapshot") else { return }
    do {
        try await Task.sleep(for: .seconds(ProcessInfo.processInfo.arguments.contains("-showVideo") ? 5 : 2))
    } catch { return }
    let marker = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("capture-ready")
    try? Data("ready".utf8).write(to: marker, options: .atomic)
}
