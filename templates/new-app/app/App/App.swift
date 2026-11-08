import RDesign
import SwiftUI

@main struct __NAME__App: App {
    var body: some Scene {
        WindowGroup { RootView().tint(RPalette.graphite) }
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
            ScrollView {
                VStack(alignment: .leading, spacing: RSpacing.m) {
                    PageHeader("__NAME__").padding(.horizontal, RSpacing.xs)
                    VStack(alignment: .leading, spacing: RSpacing.xs) {
                        Text("Today").rEyebrow().foregroundStyle(.tint)
                        Text("Nothing here yet").font(RFont.cardTitle)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .card()
                    .accessibilityIdentifier("homeCard")
                }
                .padding(.horizontal, RSpacing.m)
            }
            .background(RPalette.background)
            .toolbar(.hidden, for: .navigationBar)
        }
    }
}

struct SettingsView: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: RSpacing.xs) {
                PageHeader("Settings").padding(.horizontal, RSpacing.xl)
                Form {
                    Section {
                        RHelpLinks(privacy: AppLinks.privacy, support: AppLinks.support)
                    } footer: { RVersionFooter("__NAME__") }
                }
                .scrollContentBackground(.hidden)
            }
            .background(RPalette.background)
            .toolbar(.hidden, for: .navigationBar)
        }
    }
}

/// This app's public pages on the shared -r site (site/__SLUG__/).
enum AppLinks {
    static let privacy = URL(string: "__PAGES__privacy/")!
    static let support = URL(string: "__PAGES__support/")!
}
