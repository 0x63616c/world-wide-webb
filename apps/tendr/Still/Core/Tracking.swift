import Foundation

public struct WeightEntry: Codable, Identifiable, Equatable, Sendable {
    public var id = UUID()
    public var date: Date
    public var kilograms: Double
    public var note: String
    public var healthKitID: UUID?
    public var sourceName: String?
    public init(date: Date, kilograms: Double, note: String = "", healthKitID: UUID? = nil, sourceName: String? = nil) {
        self.date = date; self.kilograms = kilograms; self.note = note
        self.healthKitID = healthKitID; self.sourceName = sourceName
    }
}

public extension Array where Element == WeightEntry {
    /// Keeps every manual entry, while removing an obvious manually copied duplicate
    /// from charts when Apple Health contains the same reading at the same time.
    var resolvedForAnalytics: [WeightEntry] {
        filter { entry in
            guard entry.healthKitID == nil else { return true }
            return !contains { health in
                health.healthKitID != nil
                    && abs(health.date.timeIntervalSince(entry.date)) <= 60
                    && abs(health.kilograms - entry.kilograms) <= 0.05
            }
        }
    }
}

public extension Journal {
    /// Applies an incremental HealthKit result without disturbing manually entered weights.
    /// A nil anchor is treated as a full import so stale HealthKit rows are replaced.
    mutating func applyHealthKitWeightChanges(
        added: [WeightEntry],
        deletedIDs: Set<UUID>,
        replacesAllHealthKitWeights: Bool
    ) {
        let addedIDs = Set(added.compactMap(\.healthKitID))
        if replacesAllHealthKitWeights {
            weights.removeAll { $0.healthKitID != nil }
        } else {
            weights.removeAll { entry in
                guard let healthKitID = entry.healthKitID else { return false }
                return deletedIDs.contains(healthKitID)
                    || addedIDs.contains(healthKitID)
            }
        }
        weights.append(contentsOf: added)
    }
}

public struct WeightSummary {
    public var latest: Double?
    public var lost: Double?
    public var weeklyChange: Double?
    public init(entries: [WeightEntry], now: Date) {
        let actual = entries.filter { $0.date <= now && $0.kilograms.isFinite && $0.kilograms > 0 }.sorted { $0.date < $1.date }
        guard let first = actual.first, let last = actual.last else { return }
        latest = last.kilograms
        lost = first.kilograms - last.kilograms
        let weeks = last.date.timeIntervalSince(first.date) / (7 * 86400)
        weeklyChange = weeks > 0 ? (last.kilograms - first.kilograms) / weeks : nil
    }
}

public enum InjectionSide: String, Codable, CaseIterable, Sendable {
    case left, right
    public var title: String { self == .left ? "Left" : "Right" }
    public var abbreviation: String { self == .left ? "L" : "R" }
    public var accessibilityName: String { self == .left ? "Left side" : "Right side" }
    public var opposite: InjectionSide { self == .left ? .right : .left }

    /// Alternates from the latest taken dose with a recorded side (by dose date); planned, skipped and
    /// unknown-side historical doses are ignored. With no recorded side, starts on `startOn`.
    public static func suggestedNext(in doses: [DoseEntry], startOn: InjectionSide = .right) -> InjectionSide {
        let latest = doses.filter { $0.status == .taken && $0.side != nil }.max { $0.date < $1.date }
        return latest?.side?.opposite ?? startOn
    }
}

public struct DoseEntry: Codable, Identifiable, Equatable, Sendable {
    public enum Status: String, Codable, CaseIterable, Sendable { case planned, taken, skipped }
    public var id = UUID()
    public var date: Date
    public var vialID: UUID?
    public var syringeUnits: Double?
    public var syringeUnitsPerML: Double?
    public var scheduledDate: Date?
    public var medication: String
    public var milligrams: Double
    public var concentration: Double?
    public var status: Status
    public var note: String
    /// Missing in older journals; synthesized Codable keeps it nil instead of inventing a side.
    public var side: InjectionSide?
    public init(date: Date, scheduledDate: Date? = nil, medication: String, milligrams: Double, concentration: Double? = nil, status: Status = .taken, note: String = "", side: InjectionSide? = nil) {
        self.date = date; self.scheduledDate = scheduledDate; self.medication = medication
        self.milligrams = milligrams; self.concentration = concentration; self.status = status; self.note = note
        self.side = side
    }
    public func validate(now: Date) throws {
        guard milligrams.isFinite && (status == .skipped ? milligrams >= 0 : milligrams > 0),
              concentration.map({ $0.isFinite && $0 > 0 }) ?? true,
              !medication.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw TrackingError.invalidAmount }
        if status == .taken && date > now { throw TrackingError.futureTaken }
    }
}
public enum TrackingError: LocalizedError {
    case invalidAmount, futureTaken, invalidSchedule, invalidFile
    public var errorDescription: String? {
        switch self {
        case .invalidAmount: "Enter a positive, finite amount."
        case .futureTaken: "A future dose must be planned, not marked taken."
        case .invalidSchedule: "Choose at least one weekday and a valid reminder time."
        case .invalidFile: "This file is not a valid Tendr backup. Your current data has not changed."
        }
    }
}

public enum ScheduleCadence: String, Sendable {
    case none, weekdays, interval, custom
}

public struct DoseSchedule: Codable, Equatable, Sendable {
    public var weekdays: Set<Int> = []
    public var intervalDays: Int?
    /// Explicitly chosen dose days, stored at the start of each day and read back at the reminder time.
    public var customDates: [Date] = []
    public var startDate = Date()
    public var hour = 9
    public var minute = 0
    public var enabled = false
    public init() {}

    private enum CodingKeys: String, CodingKey { case weekdays, intervalDays, customDates, startDate, hour, minute, enabled }
    /// Decoded field by field so journals written before a field existed still open.
    public init(from decoder: Decoder) throws {
        self.init()
        let values = try decoder.container(keyedBy: CodingKeys.self)
        weekdays = try values.decodeIfPresent(Set<Int>.self, forKey: .weekdays) ?? []
        intervalDays = try values.decodeIfPresent(Int.self, forKey: .intervalDays)
        customDates = try values.decodeIfPresent([Date].self, forKey: .customDates) ?? []
        if let value = try values.decodeIfPresent(Date.self, forKey: .startDate) { startDate = value }
        if let value = try values.decodeIfPresent(Int.self, forKey: .hour) { hour = value }
        if let value = try values.decodeIfPresent(Int.self, forKey: .minute) { minute = value }
        enabled = try values.decodeIfPresent(Bool.self, forKey: .enabled) ?? false
    }

    public var cadence: ScheduleCadence {
        if !customDates.isEmpty { return .custom }
        if intervalDays != nil { return .interval }
        if !weekdays.isEmpty { return .weekdays }
        return .none
    }

    /// Removes the schedule entirely, leaving no upcoming doses and no reminders.
    public mutating func clear() {
        weekdays = []
        intervalDays = nil
        customDates = []
        enabled = false
    }

    /// Custom days resolved to the reminder time, de-duplicated and in order.
    public func resolvedCustomDates(calendar: Calendar = .current) -> [Date] {
        let resolved = customDates.compactMap {
            calendar.date(bySettingHour: hour, minute: minute, second: 0, of: $0)
        }
        return Array(Set(resolved)).sorted()
    }

    public func occurrences(after date: Date, count: Int, calendar: Calendar = .current) -> [Date] {
        guard count > 0, (0...23).contains(hour), (0...59).contains(minute) else { return [] }
        if !customDates.isEmpty {
            return Array(resolvedCustomDates(calendar: calendar).filter { $0 > date }.prefix(count))
        }
        if let intervalDays {
            guard (1...90).contains(intervalDays),
                  let anchor = calendar.date(bySettingHour: hour, minute: minute, second: 0, of: startDate) else { return [] }
            var next = anchor
            if next <= date {
                let elapsedDays = max(0, calendar.dateComponents([.day], from: calendar.startOfDay(for: anchor), to: calendar.startOfDay(for: date)).day ?? 0)
                let jumps = elapsedDays / intervalDays
                next = calendar.date(byAdding: .day, value: jumps * intervalDays, to: anchor) ?? anchor
                while next <= date { next = calendar.date(byAdding: .day, value: intervalDays, to: next) ?? date }
            }
            var result: [Date] = []
            for _ in 0..<min(count, 1000) {
                result.append(next)
                guard let following = calendar.date(byAdding: .day, value: intervalDays, to: next) else { break }
                next = following
            }
            return result
        }
        guard !weekdays.isEmpty, weekdays.allSatisfy({ (1...7).contains($0) }) else { return [] }
        var result: [Date] = []
        var cursor = date
        for _ in 0..<min(count, 1000) {
            let next = weekdays.compactMap { weekday in
                calendar.nextDate(after: cursor, matching: DateComponents(hour: hour, minute: minute, weekday: weekday), matchingPolicy: .nextTime, repeatedTimePolicy: .first)
            }.min()
            guard let next else { break }
            result.append(next); cursor = next
        }
        return result
    }
}

public extension DoseSchedule {
    func outstanding(asOf now: Date, doses: [DoseEntry], calendar: Calendar = .current) -> [Date] {
        guard cadence != .none else { return [] }
        // Chosen dates stand on their own; the interval and weekday cadences run from their start date.
        if cadence != .custom && startDate > now { return [] }
        var pending: [Date] = []
        var cursor = cadence == .custom ? Date.distantPast : startDate.addingTimeInterval(-1)
        while let next = occurrences(after: cursor, count: 1, calendar: calendar).first, next <= now {
            let resolved = doses.contains { dose in
                dose.status != .planned && (dose.scheduledDate == next || (dose.scheduledDate == nil && calendar.isDate(dose.date, inSameDayAs: next)))
            }
            if !resolved { pending.append(next) }
            cursor = next
        }
        return pending
    }
}
