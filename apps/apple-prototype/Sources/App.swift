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
        _store = State(initialValue: MockHomeDataSource(wifiFixture: option("-wifiFixture") ?? "secured", mode: ClimateMode(rawValue: option("-climateMode") ?? "cool") ?? .cool, ringing: args.contains("-alarmRinging")))
        openTile = HomeTile(rawValue: option("-openTile") ?? "")
        demo = args.contains("-demo")
        initialFace = ["home", "controls", "clock", "music"].firstIndex(of: option("-face") ?? "home") ?? 0
        presenceNear = option("-presence") == "near"
    }
    var body: some Scene {
        WindowGroup {
            HomeView(store: store, initialTile: openTile, demo: demo, initialFace: initialFace, initialPresence: presenceNear)
                .frame(minWidth: 960, minHeight: 720)
                .preferredColorScheme(.dark)
                #if os(iOS)
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)
                #endif
        }
        .defaultSize(width: 1366, height: 1024)
        #if os(macOS)
        .windowStyle(.hiddenTitleBar)
        #endif
    }
}
