import Foundation

/// How the weight chart's trend line is calculated. Readings are always drawn as points.
public enum WeightTrendMode: String, Codable, CaseIterable, Sendable {
    case sevenDay, fourteenDay, thirtyDay, weekly, smoothed, raw

    public static let `default` = WeightTrendMode.sevenDay

    public var title: String {
        switch self {
        case .sevenDay: "7-day average"
        case .fourteenDay: "14-day average"
        case .thirtyDay: "30-day average"
        case .weekly: "Weekly average"
        case .smoothed: "Smoothed trend"
        case .raw: "Raw readings"
        }
    }

    /// The trend line for readings sorted or unsorted; returned in date order.
    public func trend(_ readings: [WeightEntry], calendar: Calendar = .current) -> [WeightEntry] {
        let sorted = readings.sorted { $0.date < $1.date }
        switch self {
        case .sevenDay: return Self.centredAverage(sorted, days: 7)
        case .fourteenDay: return Self.centredAverage(sorted, days: 14)
        case .thirtyDay: return Self.centredAverage(sorted, days: 30)
        case .weekly: return Self.weeklyAverage(sorted, calendar: calendar)
        case .smoothed: return Self.exponentiallySmoothed(sorted)
        case .raw: return sorted
        }
    }

    /// Mean of every reading within half the window either side of each reading.
    static func centredAverage(_ readings: [WeightEntry], days: Double) -> [WeightEntry] {
        let half = days / 2 * 86400
        var start = 0, end = 0, sum = 0.0
        return readings.map { reading in
            while end < readings.count && readings[end].date <= reading.date.addingTimeInterval(half) {
                sum += readings[end].kilograms
                end += 1
            }
            while start < end && readings[start].date < reading.date.addingTimeInterval(-half) {
                sum -= readings[start].kilograms
                start += 1
            }
            var averaged = reading
            averaged.kilograms = sum / Double(end - start)
            return averaged
        }
    }

    /// One point per calendar week, at the mean time of that week's readings.
    static func weeklyAverage(_ readings: [WeightEntry], calendar: Calendar) -> [WeightEntry] {
        var weeks: [(start: Date, entries: [WeightEntry])] = []
        for reading in readings {
            let start = calendar.dateInterval(of: .weekOfYear, for: reading.date)?.start ?? reading.date
            if weeks.last?.start == start { weeks[weeks.count - 1].entries.append(reading) } else { weeks.append((start, [reading])) }
        }
        return weeks.map { week in
            var point = week.entries[0]
            let count = Double(week.entries.count)
            point.kilograms = week.entries.reduce(0) { $0 + $1.kilograms } / count
            point.date = Date(timeIntervalSinceReferenceDate: week.entries.reduce(0) { $0 + $1.date.timeIntervalSinceReferenceDate } / count)
            return point
        }
    }

    /// Exponential moving average that moves 10% of the way to each day's reading (The Hacker's Diet),
    /// scaled for gaps between weigh-ins so a missed week doesn't jolt the line.
    static func exponentiallySmoothed(_ readings: [WeightEntry], dailyWeight: Double = 0.1) -> [WeightEntry] {
        guard var trend = readings.first?.kilograms, var last = readings.first?.date else { return [] }
        return readings.map { reading in
            let days = max(0, reading.date.timeIntervalSince(last) / 86400)
            let weight = 1 - pow(1 - dailyWeight, max(days, 1))
            trend += weight * (reading.kilograms - trend)
            last = reading.date
            var point = reading
            point.kilograms = trend
            return point
        }
    }
}
