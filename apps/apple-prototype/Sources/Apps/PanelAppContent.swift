import SwiftUI
import PanelKit

/// Both navigation shells resolve the same feature view and provider here.
struct PanelAppContent: View {
    let app: PanelAppDefinition
    let store: any HomeDataSource
    let timer: PanelTimerStore
    let close: () -> Void
    @Environment(\.homeIntegration) private var integration
    @Environment(\.personalNavigation) private var personal

    var body: some View {
        Group {
            switch app.route {
            case .settings:
                if personal { PanelSettingsList() }
                else { PanelSettingsPage(back: close) }
            case .timer: PanelTimerPage(timer: timer)
            case .photoBooth:
                if let booth = integration?.photoBooth(close: close) { booth }
                else { ContentUnavailableView("Photo Booth requires the panel app", systemImage: "camera") }
            case .classic, .clock: EmptyView()
            case .feature(let feature):
                if let integration { integration.destination(feature, close: close) }
                else { prototype(feature) }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("app-screen-\(app.id)")
    }

    @ViewBuilder private func prototype(_ feature: PanelAppFeature) -> some View {
        switch feature {
        case .lights: ControlsController(store: store)
        case .climate: ClimateController(store: store)
        case .music: SonosRoomsPage(store: store)
        case .spotify: ContentUnavailableView("Spotify requires the panel app", systemImage: "music.note")
        case .weather: WeatherPage(weather: store.weather)
        case .calendar: AgendaPage(provider: store.calendar, now: store.now)
        case .walks: DogWalkPage(store: store)
        case .wifi: WifiController(wifi: store.wifi)
        case .car: TeslaController(provider: store.tesla)
        case .photos: ModulePage(tile: .photos, store: store, close: close)
        }
    }
}

extension EnvironmentValues {
    @Entry var personalNavigation = false
}

/// Device role, not a layout breakpoint. Duo keeps personal navigation while
/// its width changes; iPad wall panels keep their clock and launcher.
enum PanelExperience {
    @MainActor static var personal: Bool {
        #if os(macOS)
        true
        #else
        UIDevice.current.userInterfaceIdiom == .phone || ProcessInfo.processInfo.isiOSAppOnMac
        #endif
    }
}
