import SwiftUI
import PanelKit

/// Presentation and PIN ownership stay in Hybrid; design-worker views are unmodified.
struct TeslaModule: View {
    let provider: LiveTeslaProvider

    var body: some View {
        Group {
            if let action = provider.requestedAction {
                VStack(spacing: 0) {
                    PanelPINEntry(title: action.title, prompt: "Enter PIN to confirm", busy: provider.busy) { entered in
                        await provider.submitAndWait(pin: entered)
                    }
                    Button("Cancel") { provider.cancelCommand() }
                        .buttonStyle(.glass).controlSize(.large).padding(.bottom, 24)
                        .disabled(provider.busy)
                }
            } else {
                TeslaController(provider: provider)
                    .disabled(provider.busy)
                    .safeAreaInset(edge: .bottom) {
                        if let snapshot = provider.snapshot {
                            Button(snapshot.locked ? "Unlock car" : "Lock car") {
                                provider.request(snapshot.locked ? .unlock : .lock)
                            }.buttonStyle(.glass).disabled(provider.busy).padding()
                        }
                    }
            }
        }
        .onDisappear { provider.cancelCommand() }
    }
}

private extension TeslaAction {
    var title: String {
        switch self {
        case .lock: "Lock car"
        case .unlock: "Unlock car"
        case .climateOn: "Start preconditioning"
        case .climateOff: "Stop preconditioning"
        case .chargeStart: "Start charging"
        case .chargeStop: "Stop charging"
        }
    }
}
