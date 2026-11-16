import Foundation
import Observation

struct AgendaEvent: Identifiable, Equatable {
    let id: String
    let title: String
    let location: String
    let hour: Int
    let minute: Int
    let duration: Int
    var timeLabel: String? = nil
    var periodLabel: String? = nil
    var durationLabel: String? = nil
    /// Absolute span and calendar colour; fixture events without them fall on today.
    var start: Date? = nil
    var end: Date? = nil
    var isAllDay = false
    var color: AgendaColor? = nil
    static let noLocation = "No location"
    var place: String? { location == Self.noLocation ? nil : location }
    var minutes: Int { hour * 60 + minute }
    var time: String { timeLabel ?? String(format: "%d:%02d", hour > 12 ? hour - 12 : hour, minute) }
    var period: String { periodLabel ?? (hour >= 12 ? "PM" : "AM") }
    var durationText: String { durationLabel ?? "\(duration) min" }
}
struct AgendaColor: Equatable {
    let red: Double
    let green: Double
    let blue: Double
}
@MainActor protocol CalendarProvider: AnyObject, Observable {
    var events: [AgendaEvent] { get }
    /// Upcoming events beyond the week `events` covers.
    var later: [AgendaEvent] { get }
    /// The week loaded by `browse`, when the page looks past `events`.
    var browsed: [AgendaEvent] { get }
    func browse(from start: Date?) async
    var heading: String { get }
    /// Day boundaries follow the house time zone, not the device.
    var dayCalendar: Calendar { get }
    func dateText(at date: Date, format: String) -> String
    func next(at date: Date) -> AgendaEvent?
}
extension CalendarProvider {
    var heading: String { "Today" }
    var later: [AgendaEvent] { [] }
    var browsed: [AgendaEvent] { [] }
    func browse(from start: Date?) async {}
    var dayCalendar: Calendar { PanelTimeZone.calendar }
    func dateText(at date: Date, format: String) -> String { fixtureTime(date, format: format) }
}
@MainActor @Observable final class MockCalendarProvider: CalendarProvider {
    let events = [
        AgendaEvent(
            id: "agenda_1", title: "Morning walk", location: "Riverside Park", hour: 9, minute: 0, duration: 45,
            color: AgendaColor(red: 0.2, green: 0.78, blue: 0.35)),
        AgendaEvent(
            id: "agenda_2", title: "Design workshop", location: "Community Studio", hour: 11, minute: 0, duration: 90,
            color: AgendaColor(red: 0.04, green: 0.52, blue: 1)),
        AgendaEvent(
            id: "agenda_3", title: "Lunch break", location: "Market Café", hour: 13, minute: 0, duration: 60,
            color: AgendaColor(red: 1, green: 0.62, blue: 0.04)),
        AgendaEvent(
            id: "agenda_4", title: "Reading hour", location: "City Library", hour: 16, minute: 0, duration: 60,
            color: AgendaColor(red: 0.75, green: 0.35, blue: 0.95)),
    ]
    func next(at date: Date) -> AgendaEvent? {
        let calendar = PanelTimeZone.calendar
        let minutes = calendar.component(.hour, from: date) * 60 + calendar.component(.minute, from: date)
        return events.first { $0.minutes + $0.duration > minutes }
    }
}
struct PhotoItem: Identifiable, Equatable {
    let id: String
    let asset: String
    let title: String
    let credit: String
}
