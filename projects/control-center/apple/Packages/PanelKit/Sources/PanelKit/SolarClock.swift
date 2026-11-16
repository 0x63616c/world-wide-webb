import Foundation

public enum SolarClock {
    /// Uses absolute provider timestamps, avoiding device timezone and DST assumptions.
    /// Unknown/stale schedules return nil so callers can retain a safe presentation.
    public static func isNight(at date: Date, sunrise: Date?, sunset: Date?, nextSunrise: Date?) -> Bool? {
        guard let sunrise, let sunset, let nextSunrise,
            sunrise < sunset, sunset < nextSunrise,
            date >= sunrise.addingTimeInterval(-24 * 60 * 60), date <= nextSunrise
        else { return nil }
        return date < sunrise || (date >= sunset && date < nextSunrise)
    }
    /// While solar data loads, use the local hour instead of assuming night.
    public static func appearanceIsNight(
        at date: Date, sunrise: Date?, sunset: Date?, nextSunrise: Date?,
        weatherSymbol: String?, calendar: Calendar = .current
    ) -> Bool {
        if let night = isNight(at: date, sunrise: sunrise, sunset: sunset, nextSunrise: nextSunrise) {
            return night
        }
        let hour = calendar.component(.hour, from: date)
        return (weatherSymbol?.contains("moon") ?? false) || hour < 7 || hour >= 18
    }
    public static func timestamp(_ value: String) -> Date? {
        fractionalParser.date(from: value) ?? wholeSecondParser.date(from: value)
    }
    // ISO8601DateFormatter is thread-safe once configured; reuse avoids per-read allocation.
    nonisolated(unsafe) private static let fractionalParser: ISO8601DateFormatter = {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return parser
    }()
    nonisolated(unsafe) private static let wholeSecondParser: ISO8601DateFormatter = {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime]
        return parser
    }()
}
