import SwiftUI

@main struct __NAME__App: App {
  var body: some Scene {
    WindowGroup { RootView() }
  }
}

struct RootView: View {
  var body: some View {
    TabView {
      HomeView().tabItem { Label("Home", systemImage: "square.grid.2x2.fill") }
      SettingsView().tabItem { Label("Settings", systemImage: "gearshape") }
    }
  }
}

struct HomeView: View {
  var body: some View {
    NavigationStack {
      ContentUnavailableView("Nothing here yet", systemImage: "square.grid.2x2")
        .accessibilityIdentifier("homeCard")
        .navigationTitle("__NAME__")
    }
  }
}

struct SettingsView: View {
  var body: some View {
    NavigationStack {
      Form {
        Section {
          Link("Privacy", destination: AppLinks.privacy)
          Link("Support", destination: AppLinks.support)
        } footer: {
          Text("__NAME__")
        }
      }
      .navigationTitle("Settings")
    }
  }
}

enum AppLinks {
  static let privacy = URL(string: "__PAGES__privacy/")!
  static let support = URL(string: "__PAGES__support/")!
}
