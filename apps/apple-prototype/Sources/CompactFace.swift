import SwiftUI

/// A phone is its own composition; only the analog dial scales as artwork.
struct CompactFace: View {
    let store: any HomeDataSource
    let controls: Bool
    let zoom: Namespace.ID
    let open: (HomeTile) -> Void
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                Text(controls ? "Controls" : "Home").font(.largeTitle.bold()).padding(.top, 12)
                if !controls {
                    Button { open(.climate) } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 6) {
                                Text("Climate").font(.headline)
                                Text("A/C · \(store.climate.action)").font(.subheadline).foregroundStyle(.secondary)
                                Text("Inside \(store.climate.ambient)°").font(.subheadline).foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text("\(store.climate.target)°").font(.system(size: 88, weight: .regular)).monospacedDigit()
                        }.padding(24).frame(maxWidth: .infinity)
                    }.buttonStyle(.plain).faceGlass(radius: 32).matchedTransitionSource(id: HomeTile.climate.id, in: zoom)
                }
                LazyVGrid(columns: [GridItem(.flexible(), spacing: 16), GridItem(.flexible(), spacing: 16)], spacing: 16) {
                    ForEach(controls ? HomeTile.controlsFace : [.clock, .wifi, .bedroom, .livingRoom, .ceiling, .tesla]) { tile in
                        Button { open(tile) } label: {
                            compactTile(tile).frame(maxWidth: .infinity).frame(height: 144)
                        }.buttonStyle(.plain).faceGlass(radius: 32)
                            .matchedTransitionSource(id: tile.id, in: zoom)
                    }
                }
            }.padding(.horizontal, 20).padding(.bottom, 80)
        }.scrollIndicators(.hidden)
    }
    @ViewBuilder private func compactTile(_ tile: HomeTile) -> some View {
        if tile == .clock {
            TimelineView(.animation(minimumInterval: 1)) { _ in AnalogClock(date: store.now, minimal: true).padding(20) }
        } else {
            VStack(alignment: .leading, spacing: 10) {
                if let key = tile.accessory {
                    Image(systemName: key.symbol).font(.system(size: 32)).foregroundStyle(store.lamps.isOn(key) ? .orange : .white)
                    Text(key.name).font(.system(size: 19, weight: .semibold)).lineLimit(2)
                    Text(key == .fan ? store.climate.fanLabel : store.lamps.isOn(key) ? "On" : "Off").font(.subheadline).foregroundStyle(.secondary)
                } else if tile == .tesla {
                    Image(systemName: "car.side.fill").font(.system(size: 26)).foregroundStyle(.secondary)
                    Text("\(store.tesla.data.pct)%").font(.system(size: 38, weight: .medium, design: .rounded))
                    Text("\(store.tesla.data.range) mi · Car").font(.subheadline).foregroundStyle(.secondary)
                } else if tile == .weather {
                    Image(systemName: "cloud.sun.fill").symbolRenderingMode(.multicolor).font(.system(size: 30))
                    Text("\(store.weather.temperature)°").font(.system(size: 38, weight: .medium))
                    Text(store.weather.condition).font(.subheadline).foregroundStyle(.secondary)
                } else if tile == .sound {
                    Image(systemName: "hifispeaker.fill").font(.system(size: 30))
                    Text("Sound").font(.headline)
                    Text(store.rooms.first?.playing == true ? "Playing" : "Paused").foregroundStyle(.secondary)
                } else {
                    Image(systemName: "wifi").font(.system(size: 32))
                    Text("Guest Wi-Fi").font(.system(size: 19, weight: .semibold))
                    Text(store.wifi.ssid ?? "Not configured").font(.subheadline).foregroundStyle(.secondary)
                }
            }.padding(20).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }
}
