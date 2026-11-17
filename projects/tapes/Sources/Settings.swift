// Settings: what is in the library, which server it comes from and which build this is.
// The last tab on every platform; Command-comma opens it on the Mac.
import SwiftUI

struct SettingsView: View {
  @Environment(Store.self) private var store
  @State private var confirmsReset = false

  var body: some View {
    Form {
      Section("Library") {
        ForEach(LibrarySection.allCases) { section in
          LabeledContent(section.rawValue, value: store.summary(section))
        }
        LabeledContent("Last Refreshed") {
          if let date = store.lastRefreshed {
            // Re-reads the clock so "1 minute ago" keeps up while the page is open.
            TimelineView(.periodic(from: .now, by: 15)) { _ in
              Text(date, format: .relative(presentation: .named))
            }
          } else {
            Text("Not yet")
          }
        }
      }
      Section("Server") {
        LabeledContent("Address", value: address)
        LabeledContent("Status") {
          if let failure = store.refreshFailure {
            Text(failure).foregroundStyle(.red)
          } else if !store.available {
            Text("Showing the last copy; the server can't read the NAS.").foregroundStyle(.orange)
          } else {
            Text("Connected")
          }
        }
      }
      Section("Watch History") {
        Button("Reset Watch History…", role: .destructive) { confirmsReset = true }
          .disabled(store.watchHistoryCount == 0)
          .confirmationDialog(
            "Reset watch history?", isPresented: $confirmsReset, titleVisibility: .visible
          ) {
            Button("Reset \(store.watchHistoryCount) Items", role: .destructive) {
              store.resetWatchHistory()
            }
          } message: {
            Text(
              "Every movie, episode and DJ set goes back to unwatched, with no saved position, on all your devices. This can't be undone."
            )
          }
      }
      Section("About") {
        LabeledContent("Version", value: version)
      }
    }
    .formStyle(.grouped)
    // A readable column on a wide Mac window, on the same black page as the other tabs.
    .frame(maxWidth: 640)
    .frame(maxWidth: .infinity)
    .blackPage()
    .navigationTitle("Settings")
  }

  /// "homelab-mac-mini.local:4300"
  private var address: String {
    let url = store.server.baseURL
    return [url.host(), url.port.map(String.init)].compactMap { $0 }.joined(separator: ":")
  }

  /// "1.0.1 (7)"
  private var version: String {
    let info = Bundle.main.infoDictionary
    let short = info?["CFBundleShortVersionString"] as? String ?? "?"
    let build = info?["CFBundleVersion"] as? String ?? "?"
    return "\(short) (\(build))"
  }
}
