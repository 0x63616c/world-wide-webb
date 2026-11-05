import SwiftUI
import PanelKit

enum PanelSettingsSection: String, CaseIterable, Identifiable {
    case background = "Background", display = "Display & idle", apps = "Apps", security = "Security"
    var id: String { rawValue }
    static func sections(personal: Bool) -> [Self] { personal ? [.apps, .security] : allCases }
    var symbol: String {
        switch self { case .background: "photo"; case .display: "sun.max"; case .apps: "square.grid.2x2"; case .security: "lock.shield" }
    }
}

struct PanelSettingsPage: View {
    var back: (() -> Void)? = nil
    @Environment(\.personalNavigation) private var personal
    @State private var selection: PanelSettingsSection?
    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                ForEach(PanelSettingsSection.sections(personal: personal)) { page in
                    NavigationLink(value: page) { Label(page.rawValue, systemImage: page.symbol) }
                        .accessibilityIdentifier("settings-\(page.id)")
                }
            }.listStyle(.sidebar).navigationTitle("Settings")
                .toolbar {
                    if let back {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Apps", systemImage: "square.grid.2x2", action: back)
                                .accessibilityIdentifier("app-back")
                        }
                    }
                }
                .navigationSplitViewColumnWidth(min: 200, ideal: 260, max: 300)
        } detail: {
            NavigationStack { PanelSettingsDetail(page: selection ?? (personal ? .apps : .background)) }.id(selection)
        }.navigationSplitViewStyle(.balanced).tint(.accentColor)
    }
}

/// Push into settings on a phone, using the enclosing app NavigationStack.
struct PanelSettingsList: View {
    @Environment(\.personalNavigation) private var personal
    var body: some View {
        List(PanelSettingsSection.sections(personal: personal)) { page in
            NavigationLink { PanelSettingsDetail(page: page) } label: {
                Label(page.rawValue, systemImage: page.symbol)
            }.accessibilityIdentifier("settings-\(page.id)")
        }.navigationTitle("Settings")
    }
}

struct PanelSettingsDetail: View {
    let page: PanelSettingsSection
    @Environment(\.homeIntegration) private var integration
    @Environment(\.personalNavigation) private var personal
    @Environment(PanelAppPreferences.self) private var preferences
    @AppStorage("panel.timerSound") private var timerSound = true
    var body: some View {
        Group {
            switch page {
            case .background: WallpaperPicker(embedded: true)
            case .display: Form { PanelDisplaySettings() }.formStyle(.grouped)
            case .apps: appSettings
            case .security: security
            }
        }.navigationTitle(page.rawValue)
    }
    private var appSettings: some View {
        Form {
            Section {
                Toggle("Timer sound", isOn: $timerSound).accessibilityIdentifier("settings-timer-sound")
            } header: {
                Text("Timer")
            } footer: {
                Text("A quiet tick while running, then a repeating chime until you reset the timer. Sound uses the device volume.")
            }
            Section("App preferences") {
                ForEach(PanelAppCatalog.standard.apps.filter { if case .feature = $0.route { true } else { $0.route == .timer || $0.route == .photoBooth } }) { app in
                    NavigationLink { PanelPerAppSettings(app: app) } label: {
                        HStack(spacing: 16) {
                            Label(app.name, systemImage: app.symbol)
                            Spacer()
                            Text(personal ? (preferences[app.id].reduceMotion ? "Reduce motion" : "System motion") : (preferences[app.id].idleSeconds < 0 ? "Display setting" : PanelDurationSlider.label(preferences[app.id].idleSeconds)))
                                .font(.callout).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }.formStyle(.grouped).navigationTitle("Apps")
    }
    private var security: some View {
        Form {
            Section {
                Text("Protect private photos and confirm car commands with your six-digit PIN.")
                    .foregroundStyle(.secondary)
                if let api = integration?.panelPIN {
                    NavigationLink { PanelPINChangePage(api: api) } label: { Label("Change PIN", systemImage: "key.fill") }
                        .accessibilityIdentifier("settings-change-pin")
                } else {
                    Label("Connect to your panel server to change the PIN", systemImage: "wifi.slash").foregroundStyle(.secondary)
                }
            }
        }.formStyle(.grouped).navigationTitle("Security")
    }
}
