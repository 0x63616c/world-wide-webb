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
        _store = State(initialValue: MockHomeDataSource(wifiFixture: option("-wifiFixture") ?? "secured", mode: ClimateMode(rawValue: option("-climateMode") ?? "cool") ?? .cool, fixedNow: args.contains("-snapshot") ? ISO8601DateFormatter().date(from: "2026-10-29T17:10:30Z")! : nil, ringing: args.contains("-alarmRinging")))
        openTile = HomeTile(rawValue: option("-openTile") ?? "")
        demo = args.contains("-demo")
        initialFace = ["home", "controls", "clock", "music"].firstIndex(of: option("-face") ?? "home") ?? 0
        presenceNear = option("-presence") == "near"
    }
    var body: some Scene {
        WindowGroup {
            HomeView(store: store, initialTile: openTile, demo: demo, initialFace: initialFace, initialPresence: presenceNear)
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
