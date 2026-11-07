import PanelKit
import SwiftUI

struct PanelConnectionSettings: View {
    @State private var details = ""
    @State private var connecting = false
    @State private var message: String?
    var body: some View {
        Section("Server connection") {
            SecureField("Paste private device connection", text: $details)
                .privacySensitive()
                .accessibilityIdentifier("connection-details")
            Button(connecting ? "Connecting…" : "Verify and connect") {
                connecting = true
                Task { @MainActor in
                    defer {
                        connecting = false
                        details = ""
                    }
                    do {
                        let enrollment = try PanelEnrollment.parse(details)
                        try await enrollment.verify()
                        try Task.checkCancellation()
                        try enrollment.save()
                        message = "Connected."
                    } catch { message = "Connection failed. Check the device details and server availability." }
                }
            }
            .disabled(connecting || details.isEmpty)
            .accessibilityIdentifier("connection-save")
            Button("Disconnect this device", role: .destructive) {
                do {
                    try PanelEnrollment.disconnect()
                    message = "Disconnected."
                } catch { message = "Couldn’t remove this device’s connection." }
            }
            .disabled(connecting)
            if let message { Text(message).foregroundStyle(.secondary) }
        }
        .onDisappear { details = "" }
    }
}
