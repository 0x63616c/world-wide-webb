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
