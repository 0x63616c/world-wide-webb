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
        AgendaEvent(id: "agenda_1", title: "Morning walk", location: "Riverside Park", hour: 9, minute: 0, duration: 45),
        AgendaEvent(id: "agenda_2", title: "Design workshop", location: "Community Studio", hour: 11, minute: 0, duration: 90),
        AgendaEvent(id: "agenda_3", title: "Lunch break", location: "Market Café", hour: 13, minute: 0, duration: 60),
        AgendaEvent(id: "agenda_4", title: "Reading hour", location: "City Library", hour: 16, minute: 0, duration: 60)
    ]
    func next(at date: Date) -> AgendaEvent? {
        var calendar = Calendar(identifier: .gregorian); calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
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
        PhotoItem(id: "photo_coast", asset: "CoastPhoto", title: "Evening on the coast", credit: "Luca Bravo")
    ]
}
struct CameraFeed: Identifiable {
    let id: String
    let name: String
    let asset: String
}
@MainActor protocol CamerasProvider: AnyObject, Observable { var feeds: [CameraFeed] { get } }
@MainActor @Observable final class MockCamerasProvider: CamerasProvider {
    let feeds = [CameraFeed(id: "camera_lake", name: "Lakeside", asset: "LakeWallpaper"),
                 CameraFeed(id: "camera_woodland", name: "Woodland", asset: "ForestPhoto")]
}
struct MediaItem: Identifiable, Equatable {
    enum Kind { case album, playlist, video }
    let id: String
    let title: String
    let subtitle: String
    let kind: Kind
    let trackIndex: Int
    let tint: String
}
@MainActor protocol MediaProvider: AnyObject, Observable {
    var items: [MediaItem] { get }
    var videoURL: URL? { get }
}
@MainActor @Observable final class MockMediaProvider: MediaProvider {
    let items = [
        MediaItem(id: "media_evening", title: "Evening Hours", subtitle: "Album · 3 tracks", kind: .album, trackIndex: 0, tint: "#8f456e"),
        MediaItem(id: "media_rain", title: "After the Rain", subtitle: "Playlist · Quiet moments", kind: .playlist, trackIndex: 1, tint: "#485c85"),
        MediaItem(id: "media_focus", title: "Soft Focus", subtitle: "Playlist · Unwind", kind: .playlist, trackIndex: 2, tint: "#a56a3d"),
        MediaItem(id: "media_lake", title: "A moment by the lake", subtitle: "Silent film · 12 seconds", kind: .video, trackIndex: 0, tint: "#485c85")
    ]
    var videoURL: URL? { Bundle.main.url(forResource: "LakeStudy", withExtension: "mp4") }
}
