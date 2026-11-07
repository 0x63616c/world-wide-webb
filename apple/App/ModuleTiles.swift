import SwiftUI

struct ModuleTile: View {
    let tile: HomeTile
    let store: any HomeDataSource
    let open: () -> Void
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var compact: Bool { sizeClass == .compact }
    private var radius: CGFloat { compact ? 36 : 56 }
    var body: some View {
        Button(action: open) {
            Group {
                switch tile {
                case .weather: weather
                case .calendar: calendar
                case .photos: PhotoRotation(provider: store.photos, now: store.now, fullScreen: false)
                case .sonosRooms: rooms
                default: EmptyView()
                }
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
                .contentShape(.rect(cornerRadius: radius))
        }.buttonStyle(.plain).clipShape(ConcentricRectangle()).containerShape(.rect(cornerRadius: radius))
            .accessibilityLabel("Open \(tile.title)")
    }
    private var weather: some View {
        ZStack {
            WeatherSky(condition: store.weather.condition).saturation(0.75).brightness(-0.08)
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(store.weather.city).font(.system(size: compact ? 18 : 23, weight: .medium))
                    Text("\(store.weather.temperature)°").font(.system(size: compact ? 64 : 88, weight: .light)).monospacedDigit()
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 8) {
                    Image(systemName: "cloud.sun.fill").symbolRenderingMode(.multicolor).font(.system(size: compact ? 30 : 40))
                    Text(store.weather.condition).font(.system(size: compact ? 16 : 24, weight: .medium))
                    Text("H:\(store.weather.high)°  L:\(store.weather.low)°").font(.system(size: compact ? 15 : 24))
                }
            }.padding(compact ? 24 : 32)
        }
    }
    private var calendar: some View {
        HStack(alignment: .top, spacing: 24) {
            VStack(spacing: 0) {
                Text(store.calendar.dateText(at: store.now, format: "EEE").uppercased()).font(.system(size: compact ? 14 : 20, weight: .semibold)).foregroundStyle(.red)
                Text(store.calendar.dateText(at: store.now, format: "d")).font(.system(size: compact ? 44 : 60, weight: .light))
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("UP NEXT").font(.system(size: compact ? 11 : 13, weight: .semibold)).foregroundStyle(.primary)
                if let event = store.calendar.next(at: store.now) {
                    Text(event.title).font(.system(size: compact ? 20 : 32, weight: .semibold)).lineLimit(1)
                    Text("\(event.time) \(event.period)").font(.system(size: compact ? 16 : 24))
                    Text(event.location).font(.system(size: compact ? 15 : 20)).foregroundStyle(.primary).lineLimit(1)
                } else { Text("Nothing else today").font(.title3) }
            }
            Spacer(minLength: 0)
        }.padding(compact ? 24 : 32).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
    }
    private var rooms: some View {
        VStack(alignment: .leading, spacing: compact ? 16 : 24) {
            Label("Sonos Rooms", systemImage: "hifispeaker.fill").font(.system(size: compact ? 20 : 23, weight: .semibold))
            ForEach(store.rooms.prefix(compact ? 2 : 4)) { room in
                VStack(alignment: .leading, spacing: 5) {
                    Text(room.name).font(.system(size: compact ? 17 : 24, weight: .semibold)).lineLimit(1)
                    Text("\(room.playing ? "Playing" : "Paused") · \(room.displayVolume)%")
                        .font(.system(size: compact ? 15 : 20)).monospacedDigit().foregroundStyle(.primary)
                }
            }
            if !compact { Spacer(minLength: 0) }
            Text("All 5 rooms ›").font(.system(size: compact ? 16 : 20, weight: .medium)).foregroundStyle(.primary)
        }.padding(compact ? 24 : 24)
    }
}


/// Home owns its caption arrangement; full-screen feed composition is separate.
