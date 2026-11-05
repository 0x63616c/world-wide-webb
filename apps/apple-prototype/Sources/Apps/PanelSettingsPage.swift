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
        var detail: String {
            switch self { case .background: "Make it yours"; case .display: "Brightness and timing"; case .apps: "Sound and behaviour"; case .security: "Panel PIN" }
        }
        var color: Color {
            switch self { case .background: .purple; case .display: .orange; case .apps: .blue; case .security: .green }
        }
    }
    @State private var selection: Page? = .background
    var body: some View {
        NavigationSplitView(columnVisibility: .constant(.all)) {
            List(selection: $selection) {
                ForEach(Page.allCases) { page in
                    HStack(spacing: 16) {
                        Image(systemName: page.symbol).font(.title3)
                            .foregroundStyle(page.color).frame(width: 44, height: 44)
                            .background(page.color.opacity(0.15), in: .rect(cornerRadius: 12))
                        VStack(alignment: .leading, spacing: 5) {
                            Text(page.rawValue).font(.headline)
                            Text(page.detail).font(.subheadline).foregroundStyle(.secondary)
                        }
                    }.padding(.vertical, 12).tag(page)
                        .accessibilityIdentifier("settings-\(page.id)")
                }
            }.navigationTitle("Settings")
                .toolbar(removing: .sidebarToggle)
                .toolbar {
                    #if os(iOS)
                    ToolbarItem(placement: .topBarLeading) { PanelAppBackButton(back: back) }
                        .sharedBackgroundVisibility(.hidden)
                    #else
                    ToolbarItem(placement: .navigation) { PanelAppBackButton(back: back) }
                        .sharedBackgroundVisibility(.hidden)
                    #endif
                }
                .navigationSplitViewColumnWidth(min: 300, ideal: 330, max: 360)
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
        }.navigationSplitViewStyle(.balanced).tint(.blue).preferredColorScheme(.dark)
    }
    private var appSettings: some View {
        Form {
            Section("Timer") {
                Toggle("Timer sound", isOn: $timerSound).accessibilityIdentifier("settings-timer-sound")
                Text("A quiet tick while running, then a repeating chime until you reset the timer. Sound uses the device volume.")
                    .foregroundStyle(.secondary)
            }
            Section("App preferences") {
                ForEach(PanelAppCatalog.standard.apps.filter { if case .feature = $0.route { true } else { $0.route == .timer || $0.route == .photoBooth } }) { app in
                    NavigationLink { PanelPerAppSettings(app: app) } label: {
                        HStack(spacing: 16) {
                            PanelAppIcon(app: app, side: 44)
                            Text(app.name).font(.body.weight(.medium))
                            Spacer()
                            Text(preferences[app.id].idleSeconds < 0 ? "Display setting" : PanelDurationSlider.label(preferences[app.id].idleSeconds))
                                .font(.callout).foregroundStyle(.secondary)
                        }.padding(.vertical, 6)
                    }
                }
            }
        }.formStyle(.grouped).navigationTitle("Apps")
    }
    private var security: some View {
        Form {
            Section {
                Label("Panel PIN", systemImage: "lock.shield.fill").font(.title2.weight(.semibold)).padding(.vertical, 12)
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
