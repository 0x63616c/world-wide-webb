import SwiftUI
import AVKit

struct ModulePage: View {
    let tile: HomeTile
    let store: any HomeDataSource
    let close: () -> Void
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var compact: Bool { sizeClass == .compact }
    var body: some View {
        ZStack {
            if tile == .photos {
                PhotoRotation(provider: store.photos, now: store.now, fullScreen: true).ignoresSafeArea()
                VStack { HStack { CircleButton(symbol: "xmark", label: "Close Photos", action: close); Spacer() }; Spacer() }.padding(compact ? 24 : 38).padding(.top, compact ? 34 : 0)
            } else {
                if tile == .weather { WeatherSky(condition: store.weather.condition).ignoresSafeArea() }
                VStack(spacing: 0) {
                    ZStack {
                        Text(tile == .calendar ? "Calendar" : tile.title).font(.system(size: compact ? 20 : 25, weight: .semibold))
                        HStack { CircleButton(symbol: "xmark", label: "Close", action: close); Spacer() }
                    }.frame(height: 62).padding(.horizontal, compact ? 24 : 38).padding(.top, compact ? 56 : 30)
                    Group {
                        switch tile {
                        case .weather: WeatherPage(weather: store.weather)
                        case .calendar: AgendaPage(provider: store.calendar, now: store.now)
                        case .media: MediaPage(provider: store.media, store: store)
                        case .sonosRooms: SonosRoomsPage(store: store)
                        case .cameras: CamerasPage(provider: store.cameras, now: store.now)
                        default: EmptyView()
                        }
                    }.frame(maxWidth: .infinity, maxHeight: .infinity)
                    Text("Fixture data").font(.system(size: 12)).foregroundStyle(.secondary).padding(.bottom, 16)
                }
            }
        }.foregroundStyle(.white).tint(.white)
    }
}

struct WeatherPage: View {
    let weather: WeatherState
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var compact: Bool { sizeClass == .compact }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: compact ? 28 : 40) {
                HStack(alignment: .center) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(weather.city).font(.system(size: compact ? 30 : 44, weight: .medium))
                        Text("\(weather.temperature)°").font(.system(size: compact ? 96 : 160, weight: .light)).monospacedDigit()
                    }
                    Spacer()
                    VStack(alignment: .trailing, spacing: 12) {
                        Image(systemName: "cloud.sun.fill").font(.system(size: compact ? 40 : 72)).symbolRenderingMode(.multicolor)
                        Text(weather.condition).font(.system(size: compact ? 18 : 28, weight: .medium))
                        Text("High \(weather.high)° · Low \(weather.low)°").font(.system(size: compact ? 15 : 22))
                    }
                }
                GlassEffectContainer(spacing: 16) {
                    LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 16), count: compact ? 2 : 4), spacing: 16) {
                        weatherMetric("Feels like", value: "\(weather.feels)°", symbol: "thermometer.medium")
                        weatherMetric("Humidity", value: "\(weather.humidity)%", symbol: "humidity.fill")
                        weatherMetric("Wind", value: "\(weather.wind) mph", symbol: "wind")
                        weatherMetric(weather.solarLabel, value: weather.solarValue, symbol: "sunset.fill")
                    }
                }
                VStack(alignment: .leading, spacing: 28) {
                    Text("Next 12 hours").font(.system(size: compact ? 22 : 28, weight: .semibold))
                    ScrollView(.horizontal) {
                        HStack(spacing: compact ? 24 : 32) {
                            ForEach(weather.hours) { hour in
                                VStack(spacing: 22) {
                                    Text(hour.time).font(.system(size: 18)).foregroundStyle(.secondary)
                                    Image(systemName: hour.symbol).symbolRenderingMode(.multicolor).font(.system(size: 28))
                                    Text("\(hour.temperature)°").font(.system(size: 24, weight: .medium)).monospacedDigit()
                                }.frame(minWidth: 54)
                            }
                        }
                    }.scrollIndicators(.hidden)
                }
            }.padding(compact ? 24 : 64)
        }
    }
    private func weatherMetric(_ title: String, value: String, symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Label(title, systemImage: symbol).font(.system(size: compact ? 15 : 20))
            Text(value).font(.system(size: compact ? 26 : 36, weight: .medium, design: .rounded)).monospacedDigit()
        }.frame(maxWidth: .infinity, alignment: .leading).padding(24)
            .glassEffect(.regular, in: .rect(cornerRadius: 28))
    }
}

struct AgendaPage: View {
    let provider: any CalendarProvider
    let now: Date
    @Environment(\.horizontalSizeClass) private var sizeClass
    private var compact: Bool { sizeClass == .compact }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 32) {
                HStack(alignment: .firstTextBaseline) {
                    Text("Today").font(.system(size: compact ? 36 : 56, weight: .bold))
                    Spacer()
                    Text(fixtureTime(now, format: "EEEE, MMMM d")).font(.system(size: compact ? 16 : 24)).foregroundStyle(.secondary)
                }
                GlassEffectContainer(spacing: 16) {
                    VStack(spacing: 16) {
                        ForEach(provider.events) { event in
                            HStack(alignment: .center, spacing: compact ? 20 : 40) {
                                VStack(alignment: .trailing, spacing: 4) {
                                    Text(event.time).font(.system(size: compact ? 22 : 30, weight: .medium)).monospacedDigit()
                                    Text(event.period).font(.system(size: compact ? 13 : 16)).foregroundStyle(.secondary)
                                }.frame(width: compact ? 60 : 100, alignment: .trailing)
                                Capsule().fill(event.id == provider.next(at: now)?.id ? .orange : .white.opacity(0.35)).frame(width: 4, height: compact ? 70 : 80)
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(event.title).font(.system(size: compact ? 21 : 28, weight: .semibold))
                                    Label(event.location, systemImage: "mappin").font(.system(size: compact ? 16 : 20)).foregroundStyle(.secondary)
                                }
                                Spacer(minLength: 0)
                                if !compact { Text("\(event.duration) min").font(.system(size: 18)).foregroundStyle(.secondary) }
                            }.padding(compact ? 20 : 28).glassEffect(.regular, in: .rect(cornerRadius: 32))
                        }
                    }
                }
            }.frame(maxWidth: 1120).padding(compact ? 24 : 56).frame(maxWidth: .infinity)
        }
    }
}
