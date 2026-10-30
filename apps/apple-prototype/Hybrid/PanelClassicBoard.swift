import SwiftUI

/// Shared by Classic, module fallbacks and the Settings rollback. The return
/// control stays above WebKit during boot, navigation and reconnection.
struct PanelClassicBoard: View {
    let session: KioskSession
    var home: (() -> Void)?

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
        .overlay(alignment: .topLeading) {
            if let home { ClassicHomeButton(action: home) }
        }
        .task(id: session.reconnecting) {
            if session.reconnecting { await signalSnapshotReady() }
        }
    }
}

// Reuses WWW-63's safe-area-aware glass return control.
struct ClassicHomeButton: View {
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Label("Home", systemImage: "chevron.backward")
                .font(.title3.weight(.semibold)).padding(.horizontal, 12)
                .frame(minWidth: 88, minHeight: 56)
        }
        .buttonStyle(.glass).foregroundStyle(.white)
        .environment(\.colorScheme, .dark)
        .accessibilityIdentifier("classic-home").padding(16)
    }
}
