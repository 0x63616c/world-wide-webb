import EventKit
import Foundation

public enum CalendarAccess: Equatable, Sendable {
    case notDetermined, fullAccess, denied, restricted, writeOnly
}

/// Value boundary: EKEvent objects never escape the store's actor. No notes,
/// attendees, URLs, account details or calendar credentials are read.
public struct CalendarEvent: Codable, Sendable, Equatable {
    public let id: String
    public let title: String?
    public let location: String?
    public let start: Date
    public let end: Date
    public let isAllDay: Bool

    public init(id: String, title: String?, location: String?, start: Date, end: Date, isAllDay: Bool) {
        self.id = id; self.title = title; self.location = location
        self.start = start; self.end = end; self.isAllDay = isAllDay
    }
}

public protocol CalendarEventStore: Sendable {
    func authorization() async -> CalendarAccess
    func requestFullAccess() async throws -> Bool
    func events(in interval: DateInterval) async throws -> [CalendarEvent]
}

public enum CalendarAPIError: Error { case unavailable }

/// On-device, read-only feed. Full access is the OS permission required for
/// reading events; this API deliberately exposes no write operations.
public struct CalendarAPI: Sendable {
    private let store: any CalendarEventStore

    public init(store: any CalendarEventStore = EventKitCalendarStore()) { self.store = store }

    public func events(in interval: DateInterval) async throws -> [CalendarEvent] {
        try Task.checkCancellation()
        if await store.authorization() == .notDetermined {
            guard try await store.requestFullAccess() else { throw CalendarAPIError.unavailable }
        }
        try Task.checkCancellation()
        guard await store.authorization() == .fullAccess else { throw CalendarAPIError.unavailable }
        let events = try await store.events(in: interval)
        try Task.checkCancellation()
        guard await store.authorization() == .fullAccess else { throw CalendarAPIError.unavailable }
        return events
    }
}

public actor EventKitCalendarStore: CalendarEventStore {
    // Lazy: constructing the all-web Panel must not open EventKit or prompt.
    private var eventStore: EKEventStore?

    public init() {}

    private func store() -> EKEventStore {
        if let eventStore { return eventStore }
        let value = EKEventStore()
        eventStore = value
        return value
    }

    public func authorization() -> CalendarAccess {
        switch EKEventStore.authorizationStatus(for: .event) {
        case .notDetermined: .notDetermined
        case .fullAccess: .fullAccess
        case .writeOnly: .writeOnly
        case .restricted: .restricted
        default: .denied
        }
    }

    public func requestFullAccess() async throws -> Bool {
        try await store().requestFullAccessToEvents()
    }

    public func events(in interval: DateInterval) throws -> [CalendarEvent] {
        guard authorization() == .fullAccess else { throw CalendarAPIError.unavailable }
        let store = store()
        let predicate = store.predicateForEvents(withStart: interval.start, end: interval.end, calendars: nil)
        return store.events(matching: predicate).compactMap { event in
            guard event.status != .canceled, let start = event.startDate, let end = event.endDate else { return nil }
            // Recurring occurrences share a calendarItemIdentifier. Include the
            // occurrence start; titles/locations never participate in identity.
            return CalendarEvent(id: "\(event.calendarItemIdentifier)@\(start.timeIntervalSinceReferenceDate)",
                                 title: event.title, location: event.location, start: start, end: end,
                                 isAllDay: event.isAllDay)
        }
    }
}
