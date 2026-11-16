import Foundation
import Observation
import PanelKit

@MainActor @Observable final class LiveCalendarProvider: CalendarProvider {
    private(set) var events: [AgendaEvent] = []
    /// The next few events past this week, read only when the week is nearly empty.
    private(set) var later: [AgendaEvent] = []
    private static let laterCount = 4
    private(set) var browsed: [AgendaEvent] = []
    private(set) var availability: LiveAvailability = .loading
    private(set) var referenceDate: Date = .distantPast
    private(set) var calendars: [CalendarInfo] = []
    private(set) var selectedCalendarIDs: Set<String> = []
    private(set) var savingSelection = false
    let heading = "Calendar"
    @ObservationIgnored private let api: CalendarAPI
    @ObservationIgnored private let clock: () -> Date
    @ObservationIgnored private let calendar: () -> Calendar
    @ObservationIgnored private var records: [CalendarEvent] = []
    @ObservationIgnored private var refreshing = false
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var refreshAgain = false

    init(
        api: CalendarAPI = CalendarAPI(), now: @escaping () -> Date = Date.init,
        calendar: @escaping () -> Calendar = { PanelTimeZone.calendar }
    ) {
        self.api = api
        clock = now
        self.calendar = calendar
    }

    func refresh() async {
        guard !refreshing else {
            refreshAgain = true
            return
        }
        refreshing = true
        let started = ProcessInfo.processInfo.systemUptime
        let generation = generation
        defer {
            refreshing = false
            if refreshAgain {
                refreshAgain = false
                let retryGeneration = self.generation
                Task {
                    guard retryGeneration == self.generation else { return }
                    await refresh()
                }
            }
        }
        do {
            let now = clock()
            let calendar = calendar()
            let start = calendar.startOfDay(for: now)
            guard let end = calendar.date(byAdding: .day, value: 7, to: start) else {
                throw CalendarAPIError.unavailable
            }
            let availableCalendars = try await api.calendars()
            let selected = await api.selectedCalendarIDs(from: availableCalendars)
            let result = try await api.events(in: DateInterval(start: start, end: end))
            try Task.checkCancellation()
            guard generation == self.generation else { return }
            var beyond: [CalendarEvent] = []
            if result.filter({ $0.end > now && $0.start < end }).count < Self.laterCount,
                let horizon = calendar.date(byAdding: .year, value: 1, to: end)
            {
                beyond = try await api.events(in: DateInterval(start: end, end: horizon))
                try Task.checkCancellation()
                guard generation == self.generation else { return }
            }
            if calendars != availableCalendars { calendars = availableCalendars }
            if selectedCalendarIDs != selected { selectedCalendarIDs = selected }
            var seen = Set<String>()
            records = result.filter {
                !$0.id.isEmpty && $0.end > $0.start && $0.start < end && $0.end > start && seen.insert($0.id).inserted
            }.sorted { $0.start == $1.start ? $0.id < $1.id : $0.start < $1.start }
            let projected = records.map { project($0, now: now, calendar: calendar) }
            if events != projected { events = projected }
            var seenLater = Set<String>()
            let projectedLater = beyond.filter {
                !$0.id.isEmpty && $0.end > $0.start && $0.start >= end && seenLater.insert($0.id).inserted
            }.sorted { $0.start == $1.start ? $0.id < $1.id : $0.start < $1.start }
                .prefix(Self.laterCount).map { project($0, now: now, calendar: calendar) }
            if later != projectedLater { later = projectedLater }
            // Deliberately assigned every refresh: LiveHomeDataSource.now uses it as
            // the heartbeat that re-evaluates time-based labels.
            referenceDate = now
            if availability != .live { availability = .live }
            let elapsed = Int((ProcessInfo.processInfo.systemUptime - started) * 1000)
            if elapsed >= 1000 {
                PanelEventLog.shared.record(
                    category: "platform", action: "calendar.refresh", outcome: "slow", durationMs: elapsed)
            }
        } catch {
            guard generation == self.generation else { return }
            let outcome = error is CancellationError ? "cancelled" : "error"
            PanelEventLog.shared.record(
                category: "platform", action: "calendar.refresh", outcome: outcome,
                durationMs: Int((ProcessInfo.processInfo.systemUptime - started) * 1000))
            if case CalendarAPIError.accessDenied = error {
                clear(reason: "Calendar access is off: allow in Settings")
            } else {
                clear()
            }
        }
    }

    /// Loads the 7 days from `start` for browsing ahead; nil drops them.
    func browse(from start: Date?) async {
        let calendar = calendar()
        guard let start, let end = calendar.date(byAdding: .day, value: 7, to: start) else {
            if !browsed.isEmpty { browsed = [] }
            return
        }
        let generation = generation
        guard let result = try? await api.events(in: DateInterval(start: start, end: end)),
            !Task.isCancelled, generation == self.generation
        else { return }
        var seen = Set<String>()
        let now = clock()
        browsed = result.filter {
            !$0.id.isEmpty && $0.end > $0.start && $0.start < end && $0.end > start && seen.insert($0.id).inserted
        }.sorted { $0.start == $1.start ? $0.id < $1.id : $0.start < $1.start }
            .map { project($0, now: now, calendar: calendar) }
    }

    func setCalendarShown(_ shown: Bool, identifier: String) async {
        guard !savingSelection else { return }
        savingSelection = true
        generation += 1
        if shown { selectedCalendarIDs.insert(identifier) } else { selectedCalendarIDs.remove(identifier) }
        records = []
        events = []
        later = []
        browsed = []
        let generation = self.generation
        await api.setCalendarShown(shown, identifier: identifier)
        guard generation == self.generation else {
            savingSelection = false
            return
        }
        await refresh()
        savingSelection = false
    }

    func showAllCalendars() async {
        guard !savingSelection else { return }
        savingSelection = true
        generation += 1
        selectedCalendarIDs = Set(calendars.map(\.id))
        let generation = self.generation
        await api.showAllCalendars()
        guard generation == self.generation else {
            savingSelection = false
            return
        }
        await refresh()
        savingSelection = false
    }

    /// Prefer the next/ongoing timed event so a day-long event doesn't hide
    /// appointments. Compare absolute ends, including overnight and DST events.
    func next(at date: Date) -> AgendaEvent? {
        // Track the observable projection even when no record is visible, so
        // Home cards update when Show all restores an empty selection.
        let events = self.events
        let upcoming = records.filter { $0.end > date }
        guard let record = upcoming.first(where: { !$0.isAllDay }) ?? upcoming.first else { return nil }
        return events.first { $0.id == record.id }
    }

    var dayCalendar: Calendar { calendar() }

    func dateText(at date: Date, format: String) -> String {
        Self.format(date, format, calendar: calendar())
    }

    func stop() {
        refreshAgain = false
        generation += 1
        clear()  // Never display cached private events on foreground re-entry.
    }

    private func clear(reason: String = "Calendar is unavailable.") {
        records = []
        if !events.isEmpty { events = [] }
        if !later.isEmpty { later = [] }
        if !browsed.isEmpty { browsed = [] }
        if !calendars.isEmpty { calendars = [] }
        if !selectedCalendarIDs.isEmpty { selectedCalendarIDs = [] }
        let unavailable = LiveAvailability.unavailable(reason)
        if availability != unavailable { availability = unavailable }
    }

    private func project(_ event: CalendarEvent, now: Date, calendar: Calendar) -> AgendaEvent {
        let day =
            calendar.isDate(event.start, inSameDayAs: now) ? "" : Self.format(event.start, "MMM d", calendar: calendar)
        let duration = Int(min(event.end.timeIntervalSince(event.start) / 60, Double(Int.max / 2)))
        return AgendaEvent(
            id: event.id, title: event.title?.nilIfBlank ?? "Untitled event",
            location: event.location?.nilIfBlank ?? AgendaEvent.noLocation,
            hour: calendar.component(.hour, from: event.start),
            minute: calendar.component(.minute, from: event.start), duration: duration,
            timeLabel: event.isAllDay ? "All day" : Self.format(event.start, "h:mm", calendar: calendar),
            periodLabel: [event.isAllDay ? "" : Self.format(event.start, "a", calendar: calendar), day]
                .filter { !$0.isEmpty }.joined(separator: " · "),
            durationLabel: event.isAllDay ? "All day" : nil,
            start: event.start, end: event.end, isAllDay: event.isAllDay,
            color: calendars.first { $0.id == event.calendarID }.map {
                AgendaColor(red: $0.red, green: $0.green, blue: $0.blue)
            })
    }

    private static func format(_ date: Date, _ format: String, calendar: Calendar) -> String {
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.timeZone = calendar.timeZone
        formatter.locale = .current
        formatter.dateFormat = format
        return formatter.string(from: date)
    }
}

extension String {
    fileprivate var nilIfBlank: String? { trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : self }
}
