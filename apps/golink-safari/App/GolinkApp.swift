import SafariServices
import SwiftUI

@main
struct GolinkApp: App {
  var body: some Scene {
    WindowGroup {
      SetupView()
    }
    #if os(macOS)
      .windowResizability(.contentSize)
    #endif
  }
}

private struct SetupView: View {
  @State private var settingsError: String?

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        Image(systemName: "arrow.up.forward.app")
          .font(.system(size: 48))
          .foregroundStyle(.tint)
          .accessibilityHidden(true)
        Text("Go straight to your links")
          .font(.largeTitle.bold())
        Text(
          "Type go/repo in Safari’s address bar. Golink opens the matching link on your tailnet.")
        VStack(alignment: .leading, spacing: 16) {
          Label("Connect to Tailscale.", systemImage: "1.circle")
          Label("Keep Google as Safari’s search engine.", systemImage: "2.circle")
          #if os(macOS)
            Label("Turn on Golink in Safari → Settings → Extensions.", systemImage: "3.circle")
          #else
            Label(
              "Turn on Golink in Settings → Apps → Safari → Extensions.", systemImage: "3.circle")
          #endif
          Label("Allow access to google.com and www.google.com.", systemImage: "4.circle")
        }
        #if os(macOS)
          Button("Open Safari Extension Settings") {
            SFSafariApplication.showPreferencesForExtension(
              withIdentifier: "co.calum.golink.Extension"
            ) { error in
              if error != nil {
                Task { @MainActor in
                  settingsError = "Open Safari → Settings → Extensions and select Golink."
                }
              }
            }
          }
          .buttonStyle(.borderedProminent)
          if let settingsError { Text(settingsError).foregroundStyle(.secondary) }
        #endif
      }
      .frame(maxWidth: 480, alignment: .leading)
      .padding(32)
    }
    #if os(macOS)
      .frame(width: 520, height: 540)
    #endif
  }
}
