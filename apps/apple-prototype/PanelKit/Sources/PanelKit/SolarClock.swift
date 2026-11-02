import Foundation

public enum SolarClock {
    /// Uses absolute provider timestamps, avoiding device timezone and DST assumptions.
    /// Unknown/stale schedules return nil so callers can retain a safe presentation.
    public static func isNight(at date: Date, sunrise: Date?, sunset: Date?, nextSunrise: Date?) -> Bool? {
        guard let sunrise, let sunset, let nextSunrise,
              sunrise < sunset, sunset < nextSunrise,
              date >= sunrise.addingTimeInterval(-24 * 60 * 60), date <= nextSunrise else { return nil }
        return date < sunrise || (date >= sunset && date < nextSunrise)
    }
    public static func timestamp(_ value: String) -> Date? {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = parser.date(from: value) { return date }
        parser.formatOptions = [.withInternetDateTime]
        return parser.date(from: value)
    }
}
