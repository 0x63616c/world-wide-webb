import SwiftUI

/// Persistent Board Chrome shared by the native board and web fallback.
struct UpdateBanner: View {
    let build: Int
    @Environment(\.openURL) private var openURL
    static let testFlightURL = URL(string: "itms-beta://")!

    var body: some View {
        Button {
            openURL(Self.testFlightURL)
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "arrow.down.circle")
                Text("Update ready: build \(String(build))")
                Image(systemName: "arrow.up.right").font(.callout)
            }
            .font(.headline)
            .padding(.horizontal, 18)
            .frame(minHeight: 48)
        }
        .buttonStyle(.glass)
        .foregroundStyle(.white)
        .environment(\.colorScheme, .dark)
        .accessibilityHint("Opens TestFlight to install the update")
        .accessibilityIdentifier("update-ready-banner")
    }
}
