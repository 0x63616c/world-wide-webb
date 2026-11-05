import SwiftUI
import PanelKit

struct PanelSettingsPage: View {
    let back: () -> Void
    @Environment(\.homeIntegration) private var integration
    @Environment(PanelAppPreferences.self) private var preferences
    @AppStorage("panel.timerSound") private var timerSound = true
    private enum Page: String, CaseIterable, Identifiable {
        case background = "Background", display = "Display & idle", apps = "Apps", security = "Security"
        var id: String { rawValue }
        var symbol: String {
            switch self { case .background: "photo"; case .display: "sun.max"; case .apps: "square.grid.2x2"; case .security: "lock.shield" }
        }
    }
    @State private var selection: Page? = .background
    var body: some View {
        NavigationSplitView(columnVisibility: .constant(.all)) {
            List(selection: $selection) {
                ForEach(Page.allCases) { page in
                    NavigationLink(value: page) {
                        Label(page.rawValue, systemImage: page.symbol)
                    }
                    .accessibilityIdentifier("settings-\(page.id)")
                }
            }.listStyle(.sidebar).navigationTitle("Settings")
                .toolbar(removing: .sidebarToggle)
                .toolbar {
                    #if os(iOS)
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Apps", systemImage: "square.grid.2x2", action: back)
                            .accessibilityIdentifier("app-back")
                    }
                    #else
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close settings", systemImage: "xmark", action: back)
                            .accessibilityIdentifier("app-back")
                    }
                    #endif
                }
                .navigationSplitViewColumnWidth(min: 240, ideal: 280, max: 320)
        } detail: {
            NavigationStack {
                Group {
                    switch selection ?? .background {
                    case .background: WallpaperPicker(embedded: true)
                    case .display:
                        Form { PanelDisplaySettings() }.formStyle(.grouped)
                            .navigationTitle("Display & idle")
                    case .apps: appSettings
                    case .security: security
                    }
                }
            }.id(selection)
        }.navigationSplitViewStyle(.balanced).tint(.accentColor)
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
                            Text(preferences[app.id].idleSeconds < 0 ? "Display setting" : PanelDurationSlider.label(preferences[app.id].idleSeconds))
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
