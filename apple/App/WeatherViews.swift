import SwiftUI

struct WeatherFace: View {
    let weather: WeatherState
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Weather Now").font(.system(size: 21, weight: .semibold))
                Spacer()
                Text(weather.city).font(.system(size: 15)).opacity(0.6)
            }
            HStack(spacing: 18) {
                Image(systemName: weather.symbol).font(.system(size: 42))
                Text("\(weather.temperature)°").font(.system(size: 57, weight: .light))
                VStack(alignment: .leading, spacing: 5) {
                    Text(weather.condition).font(.system(size: 18))
                    Text("H \(weather.high)°   L \(weather.low)°").font(.system(size: 15)).opacity(0.6)
                }
                Spacer(minLength: 0)
            }
            weatherMetrics(weather, compact: true)
        }.padding(24)
    }
}
func weatherMetrics(_ weather: WeatherState, compact: Bool) -> some View {
    HStack {
        metric("Feels", "\(weather.feels)°", compact: compact)
        Spacer()
        metric("Humidity", "\(weather.humidity)%", compact: compact)
        Spacer()
        metric("Wind", "\(weather.wind) mph", compact: compact)
        Spacer()
        metric(weather.solarLabel, weather.solarValue, compact: compact)
    }
}
private func metric(_ label: String, _ value: String, compact: Bool) -> some View {
    VStack(alignment: .leading, spacing: compact ? 3 : 12) {
        Text(label).font(.system(size: compact ? 13 : 23)).opacity(0.6)
        Text(value).font(.system(size: compact ? 17 : 35, weight: .medium))
    }
}
struct WeatherController: View {
    let weather: WeatherState
    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Text(weather.city).font(.system(size: 28)).opacity(0.7)
            HStack(spacing: 45) {
                Image(systemName: weather.symbol).font(.system(size: 110, weight: .light))
                Text("\(weather.temperature)°").font(.system(size: 220, weight: .ultraLight))
            }
            Text(weather.condition).font(.system(size: 32))
            Text("H \(weather.high)°    L \(weather.low)°").font(.system(size: 24)).opacity(0.7)
            Spacer()
            weatherMetrics(weather, compact: false).padding(34)
                .glassEffect(.regular, in: .rect(cornerRadius: 34))
        }.padding(.horizontal, 100).padding(.bottom, 50)
    }
}
struct HourlyChart: View {
    let weather: WeatherState
    var compact = false
    @State private var selected: Int?
    var body: some View {
        GeometryReader { proxy in
            let chartHeight = max(30, proxy.size.height - (compact ? 42 : 105))
            let minTemp = Double((weather.hours.map(\.feels).min() ?? 50) - 2)
            let maxTemp = Double((weather.hours.map(\.temperature).max() ?? 70) + 2)
            HStack(alignment: .bottom, spacing: compact ? 6 : 18) {
                ForEach(weather.hours) { hour in
                    VStack(spacing: compact ? 5 : 18) {
                        ZStack(alignment: .bottom) {
                            Capsule().fill(.white.opacity(selected == hour.id ? 0.9 : 0.35))
                                .frame(width: compact ? 15 : 35, height: chartHeight * (Double(hour.temperature) - minTemp) / (maxTemp - minTemp))
                            Rectangle().fill(.white.opacity(0.7)).frame(width: compact ? 24 : 47, height: 1)
                                .offset(y: -chartHeight * (Double(hour.feels) - minTemp) / (maxTemp - minTemp))
                            Text("\(hour.temperature)°").font(.system(size: compact ? 12 : 22, weight: .medium))
                                .offset(y: -chartHeight * (Double(hour.temperature) - minTemp) / (maxTemp - minTemp) - (compact ? 2 : 8))
                        }.frame(maxWidth: .infinity).frame(height: chartHeight, alignment: .bottom)
                        Image(systemName: hour.symbol).font(.system(size: compact ? 14 : 29))
                        Text(hour.time).font(.system(size: compact ? 12 : 21)).opacity(0.65)
                    }
                    .contentShape(Rectangle())
                    .gesture(TapGesture().onEnded { selected = selected == hour.id ? nil : hour.id }, including: compact ? .none : .all)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(hour.time), \(hour.temperature) degrees, feels like \(hour.feels)")
                }
            }.frame(maxHeight: .infinity, alignment: .bottom)
        }
    }
}
struct HourlyController: View {
    let weather: WeatherState
    var body: some View {
        VStack(alignment: .leading, spacing: 32) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("\(weather.temperature)°").font(.system(size: 105, weight: .ultraLight))
                    Text(weather.city).font(.system(size: 24)).opacity(0.65)
                }
                Spacer()
                Text("━ Actual     ┈ Feels").font(.system(size: 21)).opacity(0.7)
            }
            HourlyChart(weather: weather)
        }.padding(.horizontal, 65).padding(.vertical, 50)
    }
}
#Preview("Weather Now", traits: .fixedLayout(width: 1366, height: 1024)) { ControllerPreview(tile: .weather) }
#Preview("Next 12 Hours", traits: .fixedLayout(width: 1366, height: 1024)) { ControllerPreview(tile: .hourly) }
