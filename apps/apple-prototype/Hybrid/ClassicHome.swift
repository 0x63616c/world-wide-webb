import SwiftUI

/// The Hybrid shell uses its module registry, independently of the prototype's
/// fixture Home faces. `all` is Classic here and is always the final tile.
extension PanelModule {
    static var homeTiles: [PanelModule] { allCases.filter { $0 != .all } + [.all] }

    var homeSymbol: String {
        switch self {
        case .all: "safari"
        case .lights: "lightbulb.2"
        case .climate: "air.conditioner.horizontal"
        case .fan: "fan"
        case .wifi: "wifi"
        case .sonos: "hifispeaker"
        case .weather: "cloud.sun"
        case .photos: "photo"
        case .walk: "dog"
        case .reminders: "checklist"
        case .alarms: "alarm"
        case .calendar: "calendar"
        case .media: "play.rectangle"
        case .tesla: "car.side"
        case .cameras: "video"
        }
    }
}

struct HybridHome: View {
    let open: (PanelModule) -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text("Home").font(.largeTitle.bold()).accessibilityAddTraits(.isHeader)
                GlassEffectContainer(spacing: 24) {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 220), spacing: 24)], spacing: 24) {
                        ForEach(PanelModule.homeTiles, id: \.self) { module in
                            Button { open(module) } label: {
                                VStack(spacing: 16) {
                                    Image(systemName: module.homeSymbol).font(.largeTitle)
                                    Text(module == .all ? "Classic" : module.title).font(.title2.weight(.semibold))
                                }
                                .padding(24)
                                .frame(maxWidth: .infinity, minHeight: 140)
                                .contentShape(.rect)
                            }
                            .buttonStyle(.plain)
                            .modifier(MixedTileMaterial(round: false, on: false))
                            .accessibilityIdentifier("home-\(module == .all ? "classic" : module.rawValue)")
                        }
                    }
                }
            }.padding(48)
        }
        .foregroundStyle(.white).tint(.white).preferredColorScheme(.dark)
        .accessibilityIdentifier("native-home")
    }
}

struct ClassicHomeButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label("Home", systemImage: "chevron.backward")
                .font(.title3.weight(.semibold))
                .padding(.horizontal, 12)
                .frame(minWidth: 88, minHeight: 56)
        }
        .buttonStyle(.glass)
        .foregroundStyle(.white)
        .environment(\.colorScheme, .dark)
        .accessibilityIdentifier("classic-home")
        .padding(16)
    }
}
