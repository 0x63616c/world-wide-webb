import AVKit
import PanelKit
import SwiftUI

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
