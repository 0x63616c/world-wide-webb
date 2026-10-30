import SwiftUI

/// Cell spans are data; every origin, edge and gutter lands on the 8-point grid.
enum MixedHomeLayout {
    static func cells(_ tile: HomeTile, controls: Bool = false) -> (x: Int, y: Int, w: Int, h: Int) {
        if controls {
            return switch tile {
            case .cameras: (0, 0, 2, 2)
            case .photos: (2, 0, 2, 1)
            case .media: (2, 1, 2, 1)
            case .sonosRooms: (4, 0, 1, 2)
            case .clock: (0, 2, 1, 1)
            case .ceiling: (1, 2, 1, 1)
            case .cabinet: (2, 2, 1, 1)
            case .wifi: (3, 2, 1, 1)
            default: (4, 2, 1, 1)
            }
        }
        return switch tile {
        case .climate: (0, 0, 2, 2)
        case .lamps: (2, 0, 1, 2)
        case .weather: (3, 0, 2, 1)
        case .tesla: (3, 1, 2, 1)
        case .calendar: (0, 2, 2, 1)
        case .sound: (2, 2, 2, 1)
        default: (4, 2, 1, 1)
        }
    }
}

struct MixedTileMaterial: ViewModifier {
    let round: Bool
    let on: Bool
    func body(content: Content) -> some View {
        let glass = on ? Glass.regular.tint(.orange.mix(with: .white, by: 0.90)) : Glass.regular
        Group {
        if round {
            content.glassEffect(glass.interactive(), in: .circle)
        } else {
            content.glassEffect(glass.interactive(), in: .rect(cornerRadius: 56))
                .containerShape(.rect(cornerRadius: 56))
        }
        }.environment(\.colorScheme, on ? .light : .dark)
    }
}
struct MixedHomeTile: View {
    let tile: HomeTile
    let store: any HomeDataSource
    let open: () -> Void
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var compact: Bool { sizeClass == .compact }
    var body: some View {
        Group {
            if tile == .climate { climate }
            else if tile == .lamps { lamps }
            else if tile == .sound { music }
            else if tile == .tesla { car }
            else if [.weather, .calendar, .media, .sonosRooms, .cameras, .photos].contains(tile) { ModuleTile(tile: tile, store: store, open: open) }
            else if tile == .clock {
                Button(action: open) { TileFace(tile: .clock, store: store, open: open) }.buttonStyle(.plain)
            } else { roundControl }
        }.foregroundStyle(isOn ? .black : .white).accessibilityIdentifier("tile-\(tile.id)")
    }
    private var climate: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(action: open) {
                HStack {
                    Label("Climate", systemImage: "air.conditioner.horizontal.fill")
                    Spacer()
                    Image(systemName: "chevron.right").font(.system(size: 18, weight: .semibold))
                }.font(.system(size: compact ? 20 : 26, weight: .semibold))
            }.buttonStyle(.plain)
            Text("Inside \(store.climate.ambient)° · \(store.climate.action)")
                .font(.system(size: compact ? 16 : 20)).foregroundStyle(.secondary)
            Spacer(minLength: 0)
            Button(action: open) {
                Text(store.climate.mode == .off ? "Off" : store.climate.mode == .heatCool ? "\(store.climate.low)–\(store.climate.high)°" : "\(store.climate.target)°")
                    .font(.system(size: compact ? 96 : 170, weight: .regular)).monospacedDigit()
                    .minimumScaleFactor(0.6).lineLimit(1).frame(maxWidth: .infinity)
            }.buttonStyle(.plain)
            Spacer(minLength: 0)
            HStack {
                step("minus", delta: -1)
                Spacer()
                Text(store.climate.mode == .off ? "Off" : store.climate.mode == .heatCool ? "Heat · Cool" : "Set to \(store.climate.target)°").font(.system(size: compact ? 16 : 22, weight: .medium))
                Spacer()
                step("plus", delta: 1)
            }
        }.padding(compact ? 24 : 32)
    }
    private func step(_ symbol: String, delta: Int) -> some View {
        Button { store.send(store.climate.mode == .heatCool ? .shiftRange(delta) : .target(store.climate.target + delta)) } label: {
            Image(systemName: symbol).font(.system(size: compact ? 24 : 32, weight: .medium)).frame(width: 48, height: 48)
        }.buttonStyle(.plain).disabled(store.climate.mode == .off)
            .accessibilityLabel(delta < 0 ? "Lower setpoint" : "Raise setpoint")
    }
    private var lamps: some View {
        VStack(spacing: 12) {
            Button(action: open) {
                VStack(spacing: 8) {
                    Image(systemName: "lamp.table.fill").font(.system(size: compact ? 32 : 40)).foregroundStyle(.orange)
                    Text("All lamps").font(.system(size: compact ? 20 : 26, weight: .semibold))
                    Text("\(store.lamps.brightness)%").font(.system(size: compact ? 30 : 44, weight: .medium, design: .rounded)).monospacedDigit()
                }.frame(maxWidth: .infinity)
            }.buttonStyle(.plain)
            LampBrightness(store: store).frame(width: compact ? 64 : 88)
            VStack(spacing: 4) {
                Text("\(store.lamps.onCount(.lamps)) of 8 on")
                Text("Adjust to turn all on").font(.system(size: compact ? 10 : 13))
            }.font(.system(size: compact ? 13 : 17)).foregroundStyle(.secondary)
        }.padding(compact ? 20 : 24)
    }
    private var music: some View {
        Button(action: open) {
            HStack(spacing: compact ? 16 : 24) {
                if let room = store.rooms.first {
                    FixtureArtwork(tint: room.artworkTint)
                        .frame(width: compact ? 72 : 112, height: compact ? 72 : 112)
                        .clipShape(.rect(cornerRadius: compact ? 16 : 24))
                    VStack(alignment: .leading, spacing: 8) {
                        Text(room.trackTitle ?? "Nothing playing").font(.system(size: compact ? 18 : 25, weight: .semibold)).lineLimit(2)
                        Text(room.trackArtist ?? "Sonos").font(.system(size: compact ? 14 : 18)).foregroundStyle(.secondary)
                        HStack(spacing: 8) {
                            PlayingEqualizer(playing: room.playing).scaleEffect(0.65).frame(width: 24, height: 20)
                            Text("Living Room").font(.system(size: compact ? 13 : 16)).foregroundStyle(.secondary)
                        }
                    }
                    Spacer(minLength: 0)
                }
            }.padding(compact ? 20 : 32).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }.buttonStyle(.plain)
    }
    private var car: some View {
        Button(action: open) {
            HStack(spacing: compact ? 16 : 24) {
                Image(systemName: "car.side.fill").font(.system(size: compact ? 38 : 56)).frame(width: compact ? 72 : 112)
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text("\(store.tesla.data.pct)%").font(.system(size: compact ? 32 : 48, weight: .medium, design: .rounded)).monospacedDigit()
                        Text("\(store.tesla.data.range) mi").font(.system(size: compact ? 16 : 20)).foregroundStyle(.secondary)
                    }
                    Text("Car · \(store.tesla.data.name)").font(.system(size: compact ? 16 : 22, weight: .semibold))
                    Label(store.tesla.data.charging ? "Charging · \(store.tesla.data.rate.formatted()) kW" : store.tesla.data.chargingState.capitalized, systemImage: store.tesla.data.charging ? "bolt.fill" : "battery.75percent").font(.system(size: compact ? 13 : 17)).foregroundStyle(store.tesla.data.charging ? .green : .white)
                }
                Spacer(minLength: 0)
            }.padding(compact ? 20 : 32).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }.buttonStyle(.plain)
    }
    private var roundControl: some View {
        VStack(spacing: 8) {
            Button {
                if let accessory = tile.accessory { store.send(.toggle(accessory)) } else { open() }
            } label: {
                Group {
                    if tile == .fan { FanSymbol(on: store.climate.fanOn && store.climate.mode != .off) }
                    else { Image(systemName: tile.accessory?.symbol ?? "wifi") }
                }.font(.system(size: compact ? 32 : 46, weight: .regular)).symbolRenderingMode(.hierarchical)
                    .foregroundStyle(isOn ? .orange : .white).frame(width: 64, height: 64)
            }.buttonStyle(.plain).accessibilityLabel(tile == .wifi ? "Open Guest Wi-Fi" : "Toggle \(tile.title)")
            Button(action: open) {
                VStack(spacing: 5) {
                    Text(tile == .wifi ? "Guest Wi-Fi" : tile == .all ? "All lights" : tile == .fan ? "Fan" : tile == .cabinet ? "Cabinet" : tile.title)
                        .font(.system(size: compact ? 16 : 22, weight: .semibold)).lineLimit(1)
                    Text(tile == .wifi ? "Tap to join" : tile == .fan ? store.climate.fanLabel : tile == .all && !isOn && (store.lamps.anyOn || store.lamps.ceiling || store.lamps.cabinet) ? "Some on" : isOn ? "On" : "Off")
                        .font(.system(size: compact ? 13 : 18)).foregroundStyle(.secondary)
                }
            }.buttonStyle(.plain)
        }.frame(maxWidth: .infinity, maxHeight: .infinity)
    }
    private var isOn: Bool {
        guard let key = tile.accessory else { return false }
        return key == .fan ? store.climate.fanOn && store.climate.mode != .off : store.lamps.isOn(key)
    }
}
