import AVKit
import PanelKit
import SwiftUI

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
                VStack {
                    HStack {
                        CircleButton(symbol: "xmark", label: "Close Photos", action: close)
                        Spacer()
                    }
                    Spacer()
                }.padding(compact ? 24 : 38).padding(.top, compact ? 34 : 0)
            } else {
                if tile == .weather { WeatherSky(condition: store.weather.condition).ignoresSafeArea() }
                VStack(spacing: 0) {
                    ZStack {
                        Text(tile == .calendar ? "Calendar" : tile.title).font(
                            .system(size: compact ? 20 : 25, weight: .semibold))
                        HStack {
                            CircleButton(symbol: "xmark", label: "Close", action: close)
                            Spacer()
                        }
                    }.frame(height: 62).padding(.horizontal, compact ? 24 : 38).padding(.top, compact ? 56 : 30)
                    Group {
                        switch tile {
                        case .weather: WeatherPage(weather: store.weather)
                        case .calendar: CalendarPage(provider: store.calendar, now: store.now)
                        case .sonosRooms: SonosRoomsPage(store: store)
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
    @Environment(\.panelCanvasProfile) private var canvas
    private var compact: Bool { sizeClass == .compact }
    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(spacing: 28) {
                    VStack(spacing: 10) {
                        Text(weather.city).font(.system(size: compact ? 30 : 40, weight: .medium))
                        Text("\(weather.temperature)°").font(
                            .system(size: compact ? 100 : 140, weight: .thin, design: .rounded)
                        ).monospacedDigit()
                        Text(weather.condition).font(.title2.weight(.medium))
                        Text("H:\(weather.high)°  L:\(weather.low)°").font(.title3)
                    }.frame(maxWidth: .infinity)
                        .frame(minHeight: compact ? 300 : max(320, geometry.size.height * 0.45))
                    VStack(alignment: .leading, spacing: 24) {
                        LazyVGrid(
                            columns: Array(
                                repeating: GridItem(.flexible()), count: compact ? 3 : canvas == .regular ? 6 : 12),
                            spacing: 24
                        ) {
                            ForEach(weather.hours) { hour in
                                VStack(spacing: 20) {
                                    Text(hour.time).font(.system(size: 18, weight: .medium))
                                    Image(systemName: hour.symbol).symbolRenderingMode(.multicolor).font(
                                        .system(size: 28)
                                    ).frame(height: 34)
                                    Text("\(hour.temperature)°").font(.system(size: 24, weight: .medium))
                                        .monospacedDigit()
                                }.frame(maxWidth: .infinity)
                            }
                        }
                        Divider().overlay(.white.opacity(0.15))
                        LazyVGrid(
                            columns: Array(
                                repeating: GridItem(.flexible(), alignment: .leading),
                                count: compact || canvas == .regular ? 2 : 4),
                            alignment: .leading, spacing: 24
                        ) {
                            weatherMetric("Feels like", value: "\(weather.feels)°", symbol: "thermometer.medium")
                            weatherMetric("Humidity", value: "\(weather.humidity)%", symbol: "humidity.fill")
                            weatherMetric("Wind", value: "\(weather.wind) mph", symbol: "wind")
                            weatherMetric(weather.solarLabel, value: weather.solarValue, symbol: "sunset.fill")
                        }
                    }.padding(24).background(.black.opacity(0.18), in: .rect(cornerRadius: 28))
                }.padding(.horizontal, compact ? 24 : 48).padding(.top, 32).padding(.bottom, 96)
                    .frame(minHeight: geometry.size.height, alignment: .top)
            }.scrollDisabled(!compact && canvas == .spacious)
        }.foregroundStyle(.white).background { WeatherAtmosphere(weather: weather).ignoresSafeArea() }
    }
    private func weatherMetric(_ title: String, value: String, symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(title, systemImage: symbol).font(.subheadline).foregroundStyle(.white.opacity(0.75))
            Text(value).font(.system(size: compact ? 26 : 32, weight: .medium)).monospacedDigit()
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}
