#if DEBUG
import Foundation
import PanelKit

/// Explicit fixture launches never instantiate EventKit or access a device account.
actor HybridCalendarFixtureStore: CalendarEventStore {
    static let now = Date(timeIntervalSince1970: 1793381400) // 2026-10-30 10:30 PDT
    static var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        return calendar
    }
    private let root: URL
    private var unavailable: Bool
    private var filename = "events.json"
    private(set) var reads = 0

    init(root: URL, unavailable: Bool = false) { self.root = root; self.unavailable = unavailable }
    func setUnavailable(_ value: Bool) { unavailable = value }
    func setFilename(_ value: String) { filename = value }
    func authorization() -> CalendarAccess { unavailable ? .denied : .fullAccess }
    func requestFullAccess() -> Bool { false }
    func events(in interval: DateInterval) throws -> [CalendarEvent] {
        reads += 1
        guard !unavailable else { throw CalendarAPIError.unavailable }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode([CalendarEvent].self,
            from: Data(contentsOf: root.appendingPathComponent("calendar/\(filename)")))
    }
}
#endif
