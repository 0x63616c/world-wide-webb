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
struct LiveWeatherSnapshot: Equatable {
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
            HourForecast(
                id: index, time: Self.hourLabel(hour, index: index, timeZone: .current),
                temperature: Int(hour.temp.rounded()),
                feels: Int(hour.feels.rounded()),
                symbol: WeatherPresentation.symbol(icon: hour.ic, isDay: hour.isDay))
        }
    }
    /// The server labels hours in its own zone; relabel from the instant so the strip matches the
    /// clock. `.current` is the panel time zone once `PanelTimeZone.apply` has run.
    static func hourLabel(_ hour: WeatherHour, index: Int, timeZone: TimeZone) -> String {
        guard index > 0, let date = AlarmDate.parse(hour.isoTime) else { return hour.t }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = "h"
        return formatter.string(from: date)
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
    @ObservationIgnored private let clock: SyncClock
    @ObservationIgnored private var pollingTask: Task<Void, Never>?
    @ObservationIgnored private var refreshing = false
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var cachedState: (zone: String, value: WeatherState)?

    init(api: WeatherAPI, clock: SyncClock = .continuous()) {
        self.api = api
        self.clock = clock
    }
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
                setAvailability(.unavailable("Weather forecast is not available yet."))
                return
            }
            let value = LiveWeatherSnapshot(now: result.0, hourly: result.1)
            if snapshot != value {
                snapshot = value
                cachedState = nil
            }
            setAvailability(.live)
        } catch {
            guard !Task.isCancelled, generation == started else { return }
            // Fixed copy avoids surfacing server details or credentials in UI/logs.
            setAvailability(
                .unavailable(panelFailureReason(error, fallback: "Weather is unavailable. Try again later.")))
        }
    }

    private func setAvailability(_ value: LiveAvailability) {
        if availability != value { availability = value }
    }

    /// Views read this every render. Parse timestamps and relabel hours once per
    /// snapshot (and panel time zone, which hour labels depend on).
    var weatherState: WeatherState? {
        guard let snapshot else { return nil }
        let zone = TimeZone.current.identifier
        if let cachedState, cachedState.zone == zone { return cachedState.value }
        let value = WeatherState(
            sunrise: SolarClock.timestamp(snapshot.now.sunriseIso),
            sunset: SolarClock.timestamp(snapshot.now.sunsetIso),
            nextSunrise: SolarClock.timestamp(snapshot.now.tomorrowSunriseIso),
            city: snapshot.city, temperature: snapshot.temperature, condition: snapshot.condition,
            symbol: snapshot.symbol,
            high: snapshot.high, low: snapshot.low, feels: snapshot.feels, humidity: snapshot.humidity,
            wind: snapshot.wind, solarLabel: snapshot.solarLabel, solarValue: snapshot.solarValue,
            hours: snapshot.hours)
        cachedState = (zone, value)
        return value
    }

    func startPolling(every interval: Duration = LiveWeatherProvider.pollingInterval) {
        guard interval > .zero else { return }
        stop()
        let clock = self.clock
        pollingTask = Task { [weak self] in
            while !Task.isCancelled {
                guard self != nil else { return }
                await self?.refresh()
                do { try await clock.sleep(interval) } catch { return }
            }
        }
    }
    func stop() {
        generation += 1
        pollingTask?.cancel()
        pollingTask = nil
    }
}
