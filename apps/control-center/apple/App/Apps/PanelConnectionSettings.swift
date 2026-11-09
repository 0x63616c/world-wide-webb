import PanelKit
import SwiftUI

struct PanelConnectionSettings: View {
    @State private var checking = false
    @State private var status: String?
    var body: some View {
        Section("Home server") {
            Text("Connect this device to Tailscale to reach your home server.")
            Button(checking ? "Checking…" : "Check connection") {
                checking = true
                Task { @MainActor in
                    defer { checking = false }
                    struct Health: Decodable, Sendable { let status: String }
                    do {
                        let value = try await PanelAPIClient(configuration: PanelConfiguration().api).get(
                            "health", as: Health.self)
                        status = value.status == "ok" ? "Connected." : "Home server unavailable."
                    } catch { status = "Cannot reach your home server. Check that Tailscale is connected." }
                }
            }.disabled(checking)
            if let status { Text(status).foregroundStyle(.secondary) }
        }
    }
}
