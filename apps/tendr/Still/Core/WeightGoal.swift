import Foundation

public struct WeightGoal: Codable, Equatable, Sendable {
    public var kilograms: Double
    public var date: Date?
    public init(kilograms: Double, date: Date? = nil) { self.kilograms = kilograms; self.date = date }
    public func requiredWeeklyChange(current: Double, now: Date) -> Double? {
        guard let date, date > now, EntryValidation.weight(current), EntryValidation.weight(kilograms) else { return nil }
        return (kilograms - current) / (date.timeIntervalSince(now) / (7 * 86400))
    }
}
