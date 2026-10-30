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
                case .cameras:
                    if let feed = store.cameras.feeds.first {
                        HomeCameraTile(feed: feed, count: store.cameras.feeds.count, now: store.now)
                    }
                case .media: media
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
                Text(fixtureTime(store.now, format: "EEE").uppercased()).font(.system(size: compact ? 14 : 20, weight: .semibold)).foregroundStyle(.red)
                Text(fixtureTime(store.now, format: "d")).font(.system(size: compact ? 44 : 60, weight: .light))
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
    private var media: some View {
        HStack(spacing: 24) {
            FixtureArtwork(tint: "#485c85").frame(width: compact ? 80 : 112, height: compact ? 80 : 112).clipShape(.rect(cornerRadius: 24))
            VStack(alignment: .leading, spacing: 8) {
                Text("Media").font(.system(size: compact ? 22 : 28, weight: .semibold))
                Text("Music & films").font(.system(size: compact ? 16 : 24)).foregroundStyle(.primary)
                Text("Browse library ›").font(.system(size: compact ? 14 : 20))
            }
            Spacer(minLength: 0)
        }.padding(compact ? 24 : 32)
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
private struct HomeCameraTile: View {
    let feed: CameraFeed
    let count: Int
    let now: Date
    @Environment(\.motionPhase) private var phase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var compact: Bool { sizeClass == .compact }
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 12, paused: reduceMotion || phase != nil)) { context in
            let t = phase ?? (reduceMotion ? 0 : context.date.timeIntervalSinceReferenceDate)
            GeometryReader { proxy in
                ZStack {
                    Image(feed.asset).resizable().scaledToFill()
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .scaleEffect(1.025 + sin(t / 8) * 0.015)
                    LinearGradient(stops: [.init(color: .black.opacity(0.62), location: 0),
                                           .init(color: .black.opacity(0.10), location: 0.52),
                                           .init(color: .black.opacity(0.65), location: 1)],
                                   startPoint: .top, endPoint: .bottom)
                    VStack(alignment: .leading, spacing: 12) {
                        HStack {
                            Label("Cameras", systemImage: "video.fill")
                                .font(.system(size: compact ? 20 : 28, weight: .semibold))
                            Spacer()
                            HStack(spacing: 6) {
                                Circle().fill(.red).frame(width: 7, height: 7)
                                Text("LIVE").font(.system(size: 14, weight: .bold))
                            }
                        }
                        Text("\(count) demo feeds").font(.system(size: compact ? 16 : 24))
                        Spacer(minLength: 8)
                        HStack(alignment: .firstTextBaseline) {
                            Text(feed.name).font(.system(size: compact ? 17 : 20, weight: .medium))
                            Spacer(minLength: 8)
                            Text(fixtureTime(phase == nil ? context.date : now, format: "HH:mm:ss"))
                                .font(.system(size: compact ? 14 : 20)).monospacedDigit()
                        }
                    }.padding(compact ? 24 : 32).foregroundStyle(.white)
                }.frame(width: proxy.size.width, height: proxy.size.height).clipped()
            }
        }
    }
}
