import SwiftUI
import PanelKit

/// Presentation and PIN ownership stay in Hybrid; design-worker views are unmodified.
struct TeslaModule: View {
    let provider: LiveTeslaProvider

    private static func reportedDate(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

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
                })
                    .safeAreaInset(edge: .top) {
                        if provider.availability != .online {
                            HStack(spacing: 10) {
                                Image(systemName: "moon.zzz.fill")
                                Text("Car offline · Last known state")
                                if let timestamp = provider.snapshot?.lastUpdatedAt,
                                   let date = Self.reportedDate(timestamp) {
                                    Text(date, style: .relative)
                                    Text("ago")
                                }
                            }.font(.callout).foregroundStyle(.secondary).padding(.vertical, 12)
                                .accessibilityIdentifier("tesla-last-known")
                        }
                    }
                    .disabled(provider.busy || provider.availability != .online)

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
