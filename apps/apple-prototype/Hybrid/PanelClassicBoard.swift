import SwiftUI

/// Shared by Classic, module fallbacks and the Settings rollback. The return
/// control is supplied by PanelRoot above its native content layer.
struct PanelClassicBoard: View {
    let session: KioskSession

    var body: some View {
        ZStack {
            Color(red: 16 / 255, green: 20 / 255, blue: 25 / 255)
            KioskWebView(session: session).id(session.generation)
            if session.reconnecting {
                Color(red: 16 / 255, green: 20 / 255, blue: 25 / 255)
                Text("Reconnecting…").foregroundStyle(.white.opacity(0.7))
                    .accessibilityAddTraits(.updatesFrequently)
            }
        }
        .ignoresSafeArea()
        .accessibilityIdentifier("web-board")
        .task(id: session.reconnecting) {
            if session.reconnecting { await signalSnapshotReady() }
        }
    }
}

