import SwiftUI

/// A phone owns its scrolling composition. The root reserves the pager's safe area.
struct CompactFace: View {
    let store: any HomeDataSource
    let controls: Bool
    let zoom: Namespace.ID
    let open: (HomeTile) -> Void
    var body: some View {
        GeometryReader { proxy in
            let layout = HomeFaceLayout.phone(in: CGSize(width: proxy.size.width, height: proxy.size.height + HomeFaceLayout.phonePagerBand), controls: controls)
            ScrollView {
                GlassEffectContainer(spacing: 8) {
                    ZStack(alignment: .topLeading) {
                        Text(controls ? "Home · More" : "Home").font(.largeTitle.bold())
                            .frame(width: layout.header.width, height: layout.header.height, alignment: .leading)
                            .position(x: layout.header.midX, y: layout.header.midY)
                        ForEach(layout.items) { item in
                            tile(item.tile, width: item.frame.width, height: item.frame.height, round: item.round)
                                .position(x: item.frame.midX, y: item.frame.midY)
                        }
                    }.frame(width: layout.contentSize.width, height: layout.contentSize.height)
                }
            }.scrollIndicators(.hidden)
                .scrollEdgeEffectStyle(.soft, for: .all)
                .scrollClipDisabled()
                .defaultScrollAnchor(ProcessInfo.processInfo.arguments.contains("-homeScrollBottom") ? .bottom : .top)

        }
    }
    private func tile(_ tile: HomeTile, width: CGFloat, height: CGFloat, round: Bool = false) -> some View {
        MixedHomeTile(tile: tile, store: store, open: { open(tile) })
            .frame(width: width, height: height)
            .modifier(MixedTileMaterial(round: round, on: tile == .fan ? store.climate.fanOn && store.climate.mode != .off : tile.accessory.map { store.lamps.isOn($0) } ?? false, imageContent: [.weather, .photos, .cameras].contains(tile)))
            .glassEffectID("\(controls ? "controls" : "home")-\(tile.id)", in: zoom)
            .matchedTransitionSource(id: tile.id, in: zoom)
    }
}
