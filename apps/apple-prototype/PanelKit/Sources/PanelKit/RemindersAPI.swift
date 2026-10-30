import EventKit
import Foundation

public struct PanelReminder: Identifiable, Codable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let list: String
    public let writable: Bool
    public init(id: String, title: String, list: String, writable: Bool) {
        self.id = id; self.title = title; self.list = list; self.writable = writable
    }
}

/// Device-local source: no backend transport, credentials, or persistence.
@MainActor public protocol RemindersServing: AnyObject {
    func list() async throws -> [PanelReminder]
    func complete(id: String) async throws
    func add(title: String) async throws
}

@MainActor public final class RemindersAPI: RemindersServing {
    private let store = EKEventStore()
    public init() {}
    private enum Failure: Error { case unavailable, missing, invalid }

    private func authorize() async throws {
        if EKEventStore.authorizationStatus(for: .reminder) == .notDetermined {
            guard try await store.requestFullAccessToReminders() else { throw Failure.unavailable }
        }
        guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess else {
            throw Failure.unavailable
        }
    }

    public func list() async throws -> [PanelReminder] {
        try await authorize()
        let predicate = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
        let items: [PanelReminder]? = await withCheckedContinuation { continuation in
            store.fetchReminders(matching: predicate) { reminders in
                continuation.resume(returning: reminders?.map {
                    PanelReminder(id: $0.calendarItemIdentifier, title: $0.title ?? "", list: $0.calendar.title,
                                  writable: $0.calendar.allowsContentModifications)
                })
            }
        }
        try Task.checkCancellation()
        guard EKEventStore.authorizationStatus(for: .reminder) == .fullAccess,
              let items else { throw Failure.unavailable }
        return items.sorted { ($0.list, $0.title, $0.id) < ($1.list, $1.title, $1.id) }
    }

    public func complete(id: String) async throws {
        try await authorize()
        guard let reminder = store.calendarItem(withIdentifier: id) as? EKReminder,
              reminder.calendar.allowsContentModifications else { throw Failure.missing }
        reminder.isCompleted = true
        try store.save(reminder, commit: true)
    }

    public func add(title: String) async throws {
        try await authorize()
        let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { throw Failure.invalid }
        guard let calendar = store.defaultCalendarForNewReminders(), calendar.allowsContentModifications else {
            throw Failure.unavailable
        }
        let reminder = EKReminder(eventStore: store)
        reminder.title = title
        reminder.calendar = calendar
        try store.save(reminder, commit: true)
    }
}
