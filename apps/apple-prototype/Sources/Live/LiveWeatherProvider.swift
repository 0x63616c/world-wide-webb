import Foundation
import Observation
import PanelKit

@MainActor protocol WeatherProvider: AnyObject, Observable {
    var snapshot: LiveWeatherSnapshot? { get }
    var availability: LiveAvailability { get }
    func refresh() async
    func startPolling(every interval: Duration)
    func stop()
}

/// A complete projection awaiting a value initializer on the prototype WeatherState.
/// Its initialized `let` properties currently prevent a truthful live WeatherState.
/// Never substitutes the mock's temperatures when live data is unavailable.
struct LiveWeatherSnapshot {
    let now: WeatherNow
    let hourly: [WeatherHour]
    var city: String { now.city }
    var temperature: Int { Int(now.temp.rounded()) }
    var condition: String { now.cond }
    var high: Int { Int(now.hi.rounded()) }
    var low: Int { Int(now.lo.rounded()) }
    var feels: Int { Int(now.feels.rounded()) }
    var humidity: Int { Int(now.hum.rounded()) }
    var wind: Int { Int(now.wind.rounded()) }
    var solarLabel: String { now.solarLabel }
    var solarValue: String { now.solarValue }
    var symbol: String { WeatherPresentation.symbol(icon: now.ic) }
    var hours: [HourForecast] {
        hourly.prefix(12).enumerated().map { index, hour in
            HourForecast(id: index, time: hour.t, temperature: Int(hour.temp.rounded()),
                         feels: Int(hour.feels.rounded()),
                         symbol: WeatherPresentation.symbol(icon: hour.ic, isDay: hour.isDay))
        }
    }
    /// WMO conditions are retained separately from the server's current description.
    var hourlyConditions: [String] { hourly.prefix(12).map { WeatherPresentation.condition(code: $0.weatherCode) } }
}

enum WeatherPresentation {
    static func symbol(icon: String, isDay: Bool = true) -> String {
        switch icon {
        case "sun": "sun.max.fill"
        case "moon": "moon.fill"
        case "cloud-sun": isDay ? "cloud.sun.fill" : "cloud.moon.fill"
        case "cloud": "cloud.fill"
        default: "questionmark"
        }
    }
    static func condition(code: Int) -> String {
        switch code {
        case 0: "Clear Sky"
        case 1: "Mainly Clear"
        case 2: "Partly Cloudy"
        case 3: "Overcast"
        case 45: "Foggy"
        case 48: "Depositing Rime Fog"
        case 51: "Light Drizzle"
        case 53: "Moderate Drizzle"
        case 55: "Dense Drizzle"
        case 56, 57: "Freezing Drizzle"
        case 61: "Slight Rain"
        case 63: "Moderate Rain"
        case 65: "Heavy Rain"
        case 66, 67: "Freezing Rain"
        case 71: "Slight Snow"
        case 73: "Moderate Snow"
        case 75: "Heavy Snow"
        case 77: "Snow Grains"
        case 80: "Slight Rain Showers"
        case 81: "Moderate Rain Showers"
        case 82: "Violent Rain Showers"
        case 85: "Slight Snow Showers"
        case 86: "Heavy Snow Showers"
        case 95: "Thunderstorm"
        case 96: "Thunderstorm with Slight Hail"
        case 99: "Thunderstorm with Heavy Hail"
        default: "Unknown"
        }
    }
}

/// Opt-in only. The existing MockHomeDataSource remains the default and preview source.
@MainActor @Observable final class LiveWeatherProvider: WeatherProvider {
    static let pollingInterval: Duration = .seconds(600)
    private(set) var snapshot: LiveWeatherSnapshot?
    private(set) var availability: LiveAvailability = .loading
    @ObservationIgnored private let api: WeatherAPI
    @ObservationIgnored private var pollingTask: Task<Void, Never>?
    @ObservationIgnored private var refreshing = false
    @ObservationIgnored private var generation = 0

    init(api: WeatherAPI) { self.api = api }
    deinit { pollingTask?.cancel() }

    func refresh() async {
        guard !refreshing else { return }
        refreshing = true
        let started = generation
        defer { refreshing = false }
        do {
            async let now = api.now()
            async let hourly = api.hourly()
            let result = try await (now, hourly)
            guard !Task.isCancelled, generation == started else { return }
            guard !result.1.isEmpty else {
                availability = .unavailable("Weather forecast is not available yet.")
                return
            }
            snapshot = LiveWeatherSnapshot(now: result.0, hourly: result.1)
            availability = .live
        } catch {
            guard !Task.isCancelled, generation == started else { return }
            // Fixed copy avoids surfacing server details or credentials in UI/logs.
            availability = .unavailable("Weather is unavailable. Try again later.")
        }
    }

    func startPolling(every interval: Duration = LiveWeatherProvider.pollingInterval) {
        guard interval > .zero else { return }
        stop()
        pollingTask = Task { [weak self] in
            while !Task.isCancelled {
                guard self != nil else { return }
                await self?.refresh()
                do { try await Task.sleep(for: interval) } catch { return }
            }
        }
    }
    func stop() {
        generation += 1
        pollingTask?.cancel()
        pollingTask = nil
    }
}
