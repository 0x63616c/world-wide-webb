import SwiftUI

extension HomeTile {
    static var panelProviders: Set<PanelModule> { Set(allCases.map(\.panelModule)) }
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
        case .media: .media
        case .cameras: .cameras
        case .photos: .photos
        case .dogwalk: .walk
        case .bedroom, .livingRoom, .ceiling, .cabinet, .all, .lamps, .lights: .lights
        }
    }
}

struct PanelHome: View {
    @State private var presentation: PanelHomePresentation

    init(store: LiveHomeDataSource, session: KioskSession, router: HybridRouter,
         navigation: PanelNavigation, updates: UpdateChecker) {
        _presentation = State(initialValue: PanelHomePresentation(store: store, session: session,
            router: router, navigation: navigation, updates: updates))
    }

    var body: some View {
        HomeView(store: presentation.store)
            .environment(\.homeIntegration, presentation)
            .accessibilityIdentifier("native-home")
            .overlay(alignment: .bottomTrailing) {
                Button(action: presentation.navigation.openClassic) {
                    Label("Classic", systemImage: "safari").font(.body)
                        .frame(minHeight: 44).padding(.horizontal, 12)
                }.buttonStyle(.glass).accessibilityIdentifier("home-classic").padding(20)
            }
    }
}

@MainActor private final class PanelHomePresentation: HomeIntegration {
    let store: LiveHomeDataSource
    let session: KioskSession
    let router: HybridRouter
    let navigation: PanelNavigation
    let updates: UpdateChecker
    let caption = ""

    init(store: LiveHomeDataSource, session: KioskSession, router: HybridRouter,
         navigation: PanelNavigation, updates: UpdateChecker) {
        self.store = store
        self.session = session
        self.router = router
        self.navigation = navigation
        self.updates = updates
    }

    func available(_ tile: HomeTile) -> Bool { store.hasLiveData(for: tile.panelModule) }

    func tile(_ tile: HomeTile, open: @escaping () -> Void) -> AnyView? {
        if tile != .clock && !available(tile) {
            return AnyView(Button(action: open) {
                VStack(spacing: 12) {
                    Text(tile == .fan ? "Fan" : tile.title).font(.title2.weight(.semibold))
                    Text("Unavailable").font(.body).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity, maxHeight: .infinity).contentShape(.rect)
            }.buttonStyle(.plain).accessibilityIdentifier("tile-unavailable-\(tile.id)"))
        }
        switch tile {
        case .sound: return AnyView(PanelSoundTile(store: store, open: open))
        case .fan:
            return AnyView(AccessoryFace(key: .fan, store: store, open: open,
                fanIsOn: store.fanProvider.fanOn))
        case .dogwalk:
            return AnyView(DogWalkTile(store: HybridWalkDataSource(store: store), open: open)
                .disabled(store.walkProvider.isMutating))
        case .photos:
            return AnyView(Button(action: open) {
                Label("Photos", systemImage: "lock.fill").font(.title2)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }.buttonStyle(.plain))
        default: return nil
        }
    }

    func musicFace(close: @escaping () -> Void) -> AnyView {
        AnyView(SonosModule(store: store, close: close, isFace: true))
    }

    func destination(_ tile: HomeTile, close: @escaping () -> Void) -> AnyView {
        AnyView(PanelHomeDestination(module: tile.panelModule, store: store, session: session,
            router: router, close: close, classic: navigation.openClassic)
            .overlay { PanelStatusOverlays(store: store, session: session, navigation: navigation, updates: updates) })
    }
}

/// Keep production adapters (alarm persistence, photo access, authenticated
/// artwork, server-time walks) at the host boundary, outside the design views.
struct PanelHomeDestination: View {
    let module: PanelModule
    let store: LiveHomeDataSource
    let session: KioskSession
    let router: HybridRouter
    let close: () -> Void
    let classic: () -> Void
    @State private var detail = true

    private var ready: Bool {
        store.hasLiveData(for: module) && (module != .alarms || session.nativeAlarms.ownsRinging)
    }

    var body: some View {
        Group {
            if router.route(for: module, hasLiveData: ready) == .native(module) {
                VStack(spacing: 0) {
                    HStack {
                        Button("Home", systemImage: "chevron.backward", action: close)
                            .accessibilityIdentifier("module-home")
                        Spacer()
                        Button(detail ? "Tile" : "Details") { detail.toggle() }
                            .accessibilityIdentifier("module-detail")
                    }.buttonStyle(.glass).padding(16)
                    HybridNativeModule(module: module, store: store, detail: detail,
                        open: { detail = true }, close: close)
                }
            } else {
                Color.clear.task { close(); classic() }
            }
        }
        .background(Color.black).preferredColorScheme(.dark).foregroundStyle(.white)
        .statusBarHidden().persistentSystemOverlays(.hidden)
    }
}

private struct PanelSoundTile: View {
    let store: LiveHomeDataSource
    let open: () -> Void
    var body: some View {
        Button(action: open) {
            HStack(spacing: 24) {
                if let room = store.rooms.first {
                    SonosArtwork(room: room, api: store.sonosArtwork)
                        .frame(width: 112, height: 112).clipped()
                    VStack(alignment: .leading, spacing: 8) {
                        Text(room.trackTitle ?? "Nothing playing").font(.title2.weight(.semibold))
                        Text(room.trackArtist ?? "Sonos").font(.body)
                        Text(room.name).font(.subheadline).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
            }.padding(32).frame(maxWidth: .infinity, maxHeight: .infinity)
        }.buttonStyle(.plain)
    }
}
