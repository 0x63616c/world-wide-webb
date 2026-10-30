import SwiftUI

/// A phone owns its scrolling composition. The root reserves the pager's safe area.
struct CompactFace: View {
    let store: any HomeDataSource
    let controls: Bool
    let zoom: Namespace.ID
    let open: (HomeTile) -> Void
    var body: some View {
        GeometryReader { proxy in
            let cell = floor((proxy.size.width - 48 - 16) / 2 / 8) * 8
            ScrollView {
                GlassEffectContainer(spacing: 8) {
                    VStack(alignment: .leading, spacing: 16) {
                        Text(controls ? "Controls" : "Home").font(.largeTitle.bold()).padding(.vertical, 8)
                        tile(.climate, width: cell * 2 + 16, height: 264)
                        HStack(spacing: 16) {
                            tile(.lamps, width: cell, height: cell * 2 + 16)
                            VStack(spacing: 16) {
                                tile(controls ? .cabinet : .ceiling, width: cell, height: cell, round: true)
                                tile(.fan, width: cell, height: cell, round: true)
                            }
                        }
                        tile(.sound, width: cell * 2 + 16, height: 136)
                        tile(.tesla, width: cell * 2 + 16, height: 152)
                        HStack(spacing: 16) {
                            tile(.clock, width: cell, height: cell, round: true)
                            tile(.wifi, width: cell, height: cell, round: true)
                        }
                    }.padding(.vertical, 16)
                }.frame(maxWidth: .infinity).padding(.bottom, 16)
            }.scrollIndicators(.hidden)
        }
    }
    private func tile(_ tile: HomeTile, width: CGFloat, height: CGFloat, round: Bool = false) -> some View {
        MixedHomeTile(tile: tile, store: store, open: { open(tile) })
            .frame(width: width, height: height)
            .modifier(MixedTileMaterial(round: round, on: tile.accessory.map { store.lamps.isOn($0) } ?? false))
            .glassEffectID("\(controls ? "controls" : "home")-\(tile.id)", in: zoom)
            .matchedTransitionSource(id: tile.id, in: zoom)
    }
}
