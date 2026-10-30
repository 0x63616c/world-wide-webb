import SwiftUI

@main
struct PanelApp: App {
    var body: some Scene {
        WindowGroup { PanelRoot() }
    }
}

struct PanelRoot: View {
    @Environment(\.scenePhase) private var scenePhase
    // Configuration and flags are intentional launch-time snapshots.
    @State private var session = KioskSession(configuration: PanelConfiguration())
    private let router = HybridRouter(flags: ModuleFlags(defaults: .standard))

    var body: some View {
        @Bindable var session = session
        HybridModuleHost(router: router, module: .all, liveView: Optional<EmptyView>.none) {
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
        }
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
        .onOpenURL { session.open($0) }
        .onChange(of: scenePhase, initial: true) { _, phase in
            if phase == .active { session.activate() }
        }
        .onDisappear { session.stop() }
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
