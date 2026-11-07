import SwiftUI
import PanelKit

/// Presentation and PIN ownership stay in Hybrid; the shared dashboard owns vehicle presentation.
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
                        .disabled(provider.busy || provider.availability != .online)
                }
            } else {
                TeslaController(provider: provider, lockAction: {
                    provider.request(provider.data.locked ? .unlock : .lock)
                }, busy: provider.busy, commandNotice: provider.commandNotice)
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
