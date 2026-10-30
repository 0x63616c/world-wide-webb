import SwiftUI

extension PanelModule {
    var title: String {
        switch self {
        case .all: "Web board"
        case .lights: "Lights"
        case .climate: "Climate"
        case .fan: "Fan"
        case .wifi: "Wi-Fi"
        case .sonos: "Sonos"
        case .weather: "Weather"
        }
    }
}

/// Reuses the design worker's leaf views, without its all-fixture HomeView or
/// ControllerHost. The web board remains the route for unimplemented modules.
struct HybridNativeModule: View {
    let module: PanelModule
    let store: LiveHomeDataSource
    let detail: Bool
    let open: () -> Void

    var body: some View {
        Group {
            if detail { controller }
            else {
                face.frame(width: 660, height: 520)
                    .modifier(MixedTileMaterial(round: module == .fan, on: faceOn))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .foregroundStyle(.white).tint(.white)
        .background(Color(red: 16 / 255, green: 20 / 255, blue: 25 / 255))
        .environment(\.colorScheme, .dark)
        .task(id: "\(module.rawValue)-\(detail)") { await signalSnapshotReady() }
        .accessibilityIdentifier("native-\(module.rawValue)-\(detail ? "detail" : "tile")")
    }

    @ViewBuilder private var face: some View {
        switch module {
        case .lights: AccessoryFace(key: .lamps, store: store, open: open)
        case .fan: fan
        case .climate: TileFace(tile: .climate, store: store, open: open)
        case .wifi: TileFace(tile: .wifi, store: store, open: open)
        case .weather: WeatherFace(weather: store.weather)
        case .sonos: SoundFace(store: store)
        case .all: EmptyView()
        }
    }

    @ViewBuilder private var controller: some View {
        switch module {
        case .lights: ControlsController(store: store)
        case .climate: ClimateController(store: store)
        case .fan:
            fan.frame(width: 660, height: 520)
                .modifier(MixedTileMaterial(round: true, on: faceOn))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .wifi: WifiController(wifi: store.wifi)
        case .weather: WeatherPage(weather: store.weather)
        // This existing page has grouping and volume, with no fixture artwork,
        // media library or seek UI (the live API supplies no playback position).
        case .sonos: SonosRoomsPage(store: store)
        case .all: EmptyView()
        }
    }

    private var faceOn: Bool {
        module == .lights ? store.lamps.anyOn : module == .fan && store.climate.fanOn
    }

    private var fan: some View {
        AccessoryFace(key: .fan, store: store, open: open, fanIsOn: store.fanProvider.fanOn)
    }
}
