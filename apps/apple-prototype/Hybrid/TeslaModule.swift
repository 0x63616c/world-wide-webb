import SwiftUI
import PanelKit

/// Presentation and PIN ownership stay in Hybrid; design-worker views are unmodified.
struct TeslaModule: View {
    let provider: LiveTeslaProvider
    @State private var pin = ""

    var body: some View {
        Group {
            if let action = provider.requestedAction {
                VStack(spacing: 24) {
                    Text(action.title).font(.title)
                    Text("Enter the panel PIN to confirm this command.")
                    SecureField("Six-digit PIN", text: $pin)
                        .keyboardType(.numberPad).textContentType(.password)
                        .textFieldStyle(.roundedBorder).frame(maxWidth: 280)
                        .accessibilityIdentifier("tesla-pin")
                    if let message = provider.errorMessage { Text(message).accessibilityAddTraits(.updatesFrequently) }
                    HStack(spacing: 24) {
                        Button("Cancel") { pin = ""; provider.cancelCommand() }.buttonStyle(.glass)
                        Button("Confirm") {
                            provider.submit(pin: pin)
                            pin = ""
                        }.buttonStyle(.glassProminent)
                            .disabled(pin.utf8.count != 6 || !pin.utf8.allSatisfy { (48...57).contains($0) })
                    }
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
                    .disabled(provider.busy)
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
        .onDisappear { pin = ""; provider.cancelCommand() }
        .onChange(of: provider.requestedAction) { _, _ in pin = "" }
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
