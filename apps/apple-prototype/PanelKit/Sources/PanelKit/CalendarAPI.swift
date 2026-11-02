import EventKit
import CoreGraphics
import Foundation

public enum CalendarAccess: Equatable, Sendable {
    case notDetermined, fullAccess, denied, restricted, writeOnly
}

/// Value boundary: EKEvent objects never escape the store's actor. No notes,
/// attendees, URLs or account credentials are read. Calendar/source names and
/// calendar colors are exposed separately for the device-local picker.
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
    func calendars() async throws -> [CalendarInfo]
    func events(in interval: DateInterval, calendarIDs: Set<String>) async throws -> [CalendarEvent]
    func authorization() async -> CalendarAccess
    func requestFullAccess() async throws -> Bool
    func events(in interval: DateInterval) async throws -> [CalendarEvent]
}

public extension CalendarEventStore {
    func calendars() async throws -> [CalendarInfo] { [] }
    func events(in interval: DateInterval, calendarIDs: Set<String>) async throws -> [CalendarEvent] {
        try await events(in: interval)
    }
}

public enum CalendarAPIError: Error { case unavailable, accessDenied }

/// On-device, read-only feed. Full access is the OS permission required for
/// reading events; this API deliberately exposes no write operations.
public struct CalendarAPI: Sendable {
    private let store: any CalendarEventStore
    private let selection: CalendarSelection

    public init(store: any CalendarEventStore = EventKitCalendarStore(), selection: CalendarSelection = CalendarSelection()) {
        self.store = store; self.selection = selection
    }

    public func calendars() async throws -> [CalendarInfo] {
        try await authorize()
        return try await store.calendars()
    }

    public func selectedCalendarIDs(from calendars: [CalendarInfo]) async -> Set<String> {
        await selection.selected(from: Set(calendars.map(\.id)))
    }

    public func setCalendarShown(_ shown: Bool, identifier: String) async {
        await selection.setShown(shown, identifier: identifier)
    }

    public func showAllCalendars() async { await selection.showAll() }

    private func authorize() async throws {
        try Task.checkCancellation()
        if await store.authorization() == .notDetermined {
            guard try await store.requestFullAccess() else { throw CalendarAPIError.accessDenied }
        }
        try Task.checkCancellation()
        guard await store.authorization() == .fullAccess else { throw CalendarAPIError.accessDenied }
    }

    public func events(in interval: DateInterval) async throws -> [CalendarEvent] {
        try await authorize()
        let calendars = try await store.calendars()
        let selected = await selectedCalendarIDs(from: calendars)
        let events = try await store.events(in: interval, calendarIDs: selected)
        try Task.checkCancellation()
        guard await store.authorization() == .fullAccess else { throw CalendarAPIError.accessDenied }
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

    public func calendars() throws -> [CalendarInfo] {
        guard authorization() == .fullAccess else { throw CalendarAPIError.accessDenied }
        return store().calendars(for: .event).map { calendar in
            let rgb = calendar.cgColor.converted(to: CGColorSpace(name: CGColorSpace.sRGB)!, intent: .defaultIntent, options: nil)
            let components = rgb?.components ?? [0.5, 0.5, 0.5, 1]
            return CalendarInfo(id: calendar.calendarIdentifier, title: calendar.title,
                sourceID: calendar.source.sourceIdentifier, sourceTitle: calendar.source.title,
                red: Double(components[0]), green: Double(components[1]), blue: Double(components[2]))
        }
    }

    public func events(in interval: DateInterval) throws -> [CalendarEvent] {
        try events(in: interval, calendarIDs: Set(calendars().map(\.id)))
    }

    public func events(in interval: DateInterval, calendarIDs: Set<String>) throws -> [CalendarEvent] {
        guard authorization() == .fullAccess else { throw CalendarAPIError.accessDenied }
        let store = store()
        let calendars = store.calendars(for: .event).filter { calendarIDs.contains($0.calendarIdentifier) }
        // EventKit treats nil as all calendars. Never issue an unrestricted query
        // when the user has hidden every calendar.
        guard !calendars.isEmpty else { return [] }
        let predicate = store.predicateForEvents(withStart: interval.start, end: interval.end, calendars: calendars)
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
