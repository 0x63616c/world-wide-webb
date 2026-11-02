import Foundation
import Observation
import PanelKit

@MainActor @Observable final class LiveCalendarProvider: CalendarProvider {
    private(set) var events: [AgendaEvent] = []
    private(set) var availability: LiveAvailability = .loading
    private(set) var referenceDate: Date = .distantPast
    let heading = "Calendar"
    @ObservationIgnored private let api: CalendarAPI
    @ObservationIgnored private let clock: () -> Date
    @ObservationIgnored private let calendar: () -> Calendar
    @ObservationIgnored private var records: [CalendarEvent] = []
    @ObservationIgnored private var refreshing = false
    @ObservationIgnored private var generation = 0

    init(api: CalendarAPI = CalendarAPI(), now: @escaping () -> Date = Date.init,
         calendar: @escaping () -> Calendar = { .autoupdatingCurrent }) {
        self.api = api; clock = now; self.calendar = calendar
    }

    func refresh() async {
        guard !refreshing else { return }
        refreshing = true
        let generation = generation
        defer { refreshing = false }
        do {
            let now = clock(), calendar = calendar()
            let start = calendar.startOfDay(for: now)
            guard let end = calendar.date(byAdding: .day, value: 7, to: start) else {
                throw CalendarAPIError.unavailable
            }
            let result = try await api.events(in: DateInterval(start: start, end: end))
            try Task.checkCancellation()
            guard generation == self.generation else { return }
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

    /// Prefer the next/ongoing timed event so a day-long event doesn't hide
    /// appointments. Compare absolute ends, including overnight and DST events.
    func next(at date: Date) -> AgendaEvent? {
        let upcoming = records.filter { $0.end > date }
        guard let record = upcoming.first(where: { !$0.isAllDay }) ?? upcoming.first else { return nil }
        return events.first { $0.id == record.id }
    }

    func dateText(at date: Date, format: String) -> String {
        Self.format(date, format, calendar: calendar())
    }

    func stop() {
        generation += 1
        clear() // Never display cached private events on foreground re-entry.
    }

    private func clear() {
        records = []; events = []
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
