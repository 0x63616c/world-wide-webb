import Foundation
import Observation
import PanelKit

@MainActor @Observable final class LiveCalendarProvider: CalendarProvider {
    private(set) var events: [AgendaEvent] = []
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

    init(api: CalendarAPI = CalendarAPI(), now: @escaping () -> Date = Date.init,
         calendar: @escaping () -> Calendar = { .autoupdatingCurrent }) {
        self.api = api; clock = now; self.calendar = calendar
    }

    func refresh() async {
        guard !refreshing else { refreshAgain = true; return }
        refreshing = true
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
            let now = clock(), calendar = calendar()
            let start = calendar.startOfDay(for: now)
            guard let end = calendar.date(byAdding: .day, value: 7, to: start) else {
                throw CalendarAPIError.unavailable
            }
            let availableCalendars = try await api.calendars()
            let selected = await api.selectedCalendarIDs(from: availableCalendars)
            let result = try await api.events(in: DateInterval(start: start, end: end))
            try Task.checkCancellation()
            guard generation == self.generation else { return }
            calendars = availableCalendars
            selectedCalendarIDs = selected
            var seen = Set<String>()
            records = result.filter {
                !$0.id.isEmpty && $0.end > $0.start && $0.start < end && $0.end > start && seen.insert($0.id).inserted
            }.sorted { $0.start == $1.start ? $0.id < $1.id : $0.start < $1.start }
            events = records.map { project($0, now: now, calendar: calendar) }
            referenceDate = now
            availability = .live
        } catch {
            guard generation == self.generation else { return }
            clear()
            if case CalendarAPIError.accessDenied = error {
                availability = .unavailable("Calendar access is off: allow in Settings")
            }
        }
    }

    func setCalendarShown(_ shown: Bool, identifier: String) async {
        guard !savingSelection else { return }
        savingSelection = true
        generation += 1
        if shown { selectedCalendarIDs.insert(identifier) } else { selectedCalendarIDs.remove(identifier) }
        records = []; events = []
        let generation = self.generation
        await api.setCalendarShown(shown, identifier: identifier)
        guard generation == self.generation else { savingSelection = false; return }
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
        guard generation == self.generation else { savingSelection = false; return }
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

    func dateText(at date: Date, format: String) -> String {
        Self.format(date, format, calendar: calendar())
    }

    func stop() {
        refreshAgain = false
        generation += 1
        clear() // Never display cached private events on foreground re-entry.
    }

    private func clear() {
        records = []; events = []; calendars = []; selectedCalendarIDs = []
        availability = .unavailable("Calendar is unavailable.")
    }

    private func project(_ event: CalendarEvent, now: Date, calendar: Calendar) -> AgendaEvent {
        let day = calendar.isDate(event.start, inSameDayAs: now) ? "" : Self.format(event.start, "MMM d", calendar: calendar)
        let duration = Int(min(event.end.timeIntervalSince(event.start) / 60, Double(Int.max / 2)))
        return AgendaEvent(id: event.id, title: event.title?.nilIfBlank ?? "Untitled event",
                           location: event.location?.nilIfBlank ?? "No location",
                           hour: calendar.component(.hour, from: event.start),
                           minute: calendar.component(.minute, from: event.start), duration: duration,
                           timeLabel: event.isAllDay ? "All day" : Self.format(event.start, "h:mm", calendar: calendar),
                           periodLabel: [event.isAllDay ? "" : Self.format(event.start, "a", calendar: calendar), day]
                            .filter { !$0.isEmpty }.joined(separator: " · "),
                           durationLabel: event.isAllDay ? "All day" : nil)
    }

    private static func format(_ date: Date, _ format: String, calendar: Calendar) -> String {
        let formatter = DateFormatter()
        formatter.calendar = calendar; formatter.timeZone = calendar.timeZone
        formatter.locale = .current; formatter.dateFormat = format
        return formatter.string(from: date)
    }
}

private extension String {
    var nilIfBlank: String? { trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : self }
}
