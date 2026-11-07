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
    var minutes: Int { hour * 60 + minute }
    var time: String { timeLabel ?? String(format: "%d:%02d", hour > 12 ? hour - 12 : hour, minute) }
    var period: String { periodLabel ?? (hour >= 12 ? "PM" : "AM") }
    var durationText: String { durationLabel ?? "\(duration) min" }
}
@MainActor protocol CalendarProvider: AnyObject, Observable {
    var events: [AgendaEvent] { get }
    var heading: String { get }
    func dateText(at date: Date, format: String) -> String
    func next(at date: Date) -> AgendaEvent?
}
extension CalendarProvider {
    var heading: String { "Today" }
    func dateText(at date: Date, format: String) -> String { fixtureTime(date, format: format) }
}
@MainActor @Observable final class MockCalendarProvider: CalendarProvider {
    let events = [
        AgendaEvent(
            id: "agenda_1", title: "Morning walk", location: "Riverside Park", hour: 9, minute: 0, duration: 45),
        AgendaEvent(
            id: "agenda_2", title: "Design workshop", location: "Community Studio", hour: 11, minute: 0, duration: 90),
        AgendaEvent(id: "agenda_3", title: "Lunch break", location: "Market Café", hour: 13, minute: 0, duration: 60),
        AgendaEvent(id: "agenda_4", title: "Reading hour", location: "City Library", hour: 16, minute: 0, duration: 60),
    ]
    func next(at date: Date) -> AgendaEvent? {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
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
@MainActor protocol PhotosProvider: AnyObject, Observable { var photos: [PhotoItem] { get } }
@MainActor @Observable final class MockPhotosProvider: PhotosProvider {
    let photos = [
        PhotoItem(id: "photo_lake", asset: "LakeWallpaper", title: "Mountain lake", credit: "Luca Bravo"),
        PhotoItem(id: "photo_forest", asset: "ForestPhoto", title: "Woodland light", credit: "Johannes Plenio"),
        PhotoItem(id: "photo_coast", asset: "CoastPhoto", title: "Evening on the coast", credit: "Luca Bravo"),
    ]
}
