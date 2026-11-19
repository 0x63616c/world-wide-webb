import PanelKit
import SwiftUI

extension HomeTile {
    static var panelProviders: Set<PanelModule> {
        [.climate, .fan, .wifi, .alarms, .weather, .sonos, .tesla, .calendar, .lights, .photos]
    }
    var panelModule: PanelModule {
        switch self {
        case .climate: .climate
        case .fan: .fan
        case .wifi: .wifi
        case .clock, .alarm: .alarms
        case .weather, .hourly: .weather
        case .sound, .sonosRooms: .sonos
        case .tesla: .tesla
        case .calendar: .calendar
        case .photos: .photos
        case .bedroom, .livingRoom, .ceiling, .cabinet, .all, .lamps, .lights: .lights
        }
    }
}

struct PanelHome: View {
    @Environment(\.motionPhase) private var inheritedMotionPhase
    @State private var presentation: PanelHomePresentation
    let timer: PanelTimerStore

    init(
        store: LiveHomeDataSource, session: PanelSession,
        navigation: PanelNavigation, timer: PanelTimerStore
    ) {
        self.timer = timer
        _presentation = State(
            initialValue: PanelHomePresentation(
                store: store, session: session,
                navigation: navigation))
    }

    var body: some View {
        HomeView(
            store: presentation.store,
            initialFace: presentation.navigation.homeStartsInLauncher ? HomeFacePage.home : HomeFacePage.clock,
            managedTimer: timer
        )
        .environment(\.homeIntegration, presentation)
        .environment(\.motionPhase, Self.fixtureMotionPhase ?? inheritedMotionPhase)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("native-home")
        .overlay(alignment: .topLeading) {
            #if DEBUG
                if ProcessInfo.processInfo.arguments.contains("-hybridControlWrites") {
                    Text(HybridControlWriteTrace.shared.value).font(.caption2)
                        .foregroundStyle(
                            ProcessInfo.processInfo.arguments.contains("-hideFixtureTrace")
                                ? Color.clear : Color.primary
                        )
                        .accessibilityIdentifier("fixture-control-write").allowsHitTesting(false)
                }
            #endif
        }

    }
    // The snapshot seam pauses decorative loops in fixture runs so XCTest can
    // become idle and the shared simulator does not render them continuously.
    private static var fixtureMotionPhase: Double? {
        #if DEBUG
            ProcessInfo.processInfo.arguments.contains("-hybridFixtures")
                && !ProcessInfo.processInfo.arguments.contains("-hybridMotion") ? 0 : nil
        #else
            nil
        #endif
    }

}

@MainActor final class PanelHomePresentation: HomeIntegration {
    let store: LiveHomeDataSource
    let session: PanelSession
    let navigation: PanelNavigation
    var panelPIN: PanelPINAPI? { store.panelPIN }
    var profilesAPI: ProfilesAPI? { store.profilesAPI }
    var wallSwitchesAPI: WallSwitchesAPI? { store.wallSwitchesAPI }
    func photoBooth(close: @escaping () -> Void) -> AnyView? {
        AnyView(LivePhotoBoothModule(camera: store.photoBoothCamera, photos: store.photosProvider, close: close))
    }

    init(
        store: LiveHomeDataSource, session: PanelSession,
        navigation: PanelNavigation
    ) {
        self.store = store
        self.session = session
        self.navigation = navigation
    }

    func artwork(_ room: SoundRoom) -> AnyView? {
        AnyView(SonosArtwork(room: room, api: store.sonosArtwork))
    }

    func destination(_ tile: HomeTile, close: @escaping () -> Void) -> AnyView {
        AnyView(
            PanelHomeDestination(
                module: tile.panelModule, store: store, session: session,
                close: close
            ))
    }
}

/// Keep production adapters (alarm persistence, photo access, authenticated
/// artwork) at the host boundary, outside the design views.
struct PanelHomeDestination: View {
    let module: PanelModule
    let store: LiveHomeDataSource
    let session: PanelSession
    let close: () -> Void

    private var ready: Bool {
        store.hasLiveData(for: module) && (module != .alarms || session.nativeAlarms.ownsRinging)
    }

    private var awaitingWifi: Bool {
        module == .wifi && store.wifiProvider.availability == .loading
    }

    var body: some View {
        Group {
            if ready || awaitingWifi || module == .calendar {
                HybridNativeModule(module: module, store: store, detail: true, open: {}, close: close)
                    .opacity(awaitingWifi ? 0 : 1).allowsHitTesting(!awaitingWifi)
                    .overlay { if awaitingWifi { ProgressView("Refreshing Wi-Fi") } }
            } else {
                ModuleStatusFace(
                    title: module.title,
                    status: store.status(for: HomeModule(rawValue: module.rawValue) ?? .lights)
                ).padding(48)
            }
        }
        // The shell clips the complete app surface. Keep this host unclipped so
        // module backgrounds can extend beneath the shell's Back safe area.
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.black).preferredColorScheme(.dark).foregroundStyle(.white)
        .statusBarHidden().persistentSystemOverlays(.hidden)
    }
}

struct PanelHomeButton: View {
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: "chevron.left")
                .font(.system(size: 22, weight: .semibold))
                .frame(width: 48, height: 48).contentShape(.circle)
        }.buttonStyle(.glass).buttonBorderShape(.circle)
            .accessibilityLabel("Back").accessibilityIdentifier("module-home")
    }
}

struct PanelWeatherModule: View {
    let weather: WeatherState
    var body: some View { WeatherPage(weather: weather) }
}
