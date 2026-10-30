import Foundation
import Observation

enum WalkDevice: String, Codable {
    case iPhone, iPad, mac = "Mac"
}

struct DogWalk: Identifiable, Equatable {
    let id: String
    let startedAt: Date
    let endedAt: Date?
    let startedBy: WalkDevice
    func duration(at now: Date) -> TimeInterval { max(0, (endedAt ?? now).timeIntervalSince(startedAt)) }
}
struct WalkDay: Identifiable {
    let date: Date
    let minutes: Double
    var id: Date { date }
}
struct WalkSummary {
    let weeklyMinutes: Int
    let averageMinutes: Int
    let streak: Int
}
@MainActor protocol WalkProvider: AnyObject, Observable {
    var activeWalk: DogWalk? { get }
    var history: [DogWalk] { get }
    func start(at date: Date)
    func stop(at date: Date)
}
extension WalkProvider {
    func days(_ count: Int, ending now: Date) -> [WalkDay] {
        let calendar = Self.walkCalendar
        let today = calendar.startOfDay(for: now)
        let grouped = Dictionary(grouping: history, by: { calendar.startOfDay(for: $0.startedAt) })
        return (0..<count).reversed().map { offset in
            let day = calendar.date(byAdding: .day, value: -offset, to: today)!
            return WalkDay(date: day, minutes: (grouped[day] ?? []).reduce(0) { $0 + $1.duration(at: now) / 60 })
        }
    }
    func summary(at now: Date) -> WalkSummary {
        let calendar = Self.walkCalendar
        let week = calendar.dateInterval(of: .weekOfYear, for: now)!
        let weekly = history.filter { week.contains($0.startedAt) && $0.startedAt <= now }
        let weeklySeconds = weekly.reduce(0) { $0 + $1.duration(at: now) }
        let recent = days(30, ending: now)
        let activeDays = recent.reversed().drop(while: { $0.date == calendar.startOfDay(for: now) && $0.minutes == 0 })
        let streak = activeDays.prefix(while: { $0.minutes > 0 }).count
        return WalkSummary(weeklyMinutes: Int(weeklySeconds / 60),
                           averageMinutes: history.isEmpty ? 0 : Int(history.reduce(0) { $0 + $1.duration(at: now) } / Double(history.count) / 60),
                           streak: streak)
    }
    func lastWalkLabel(at now: Date) -> String {
        guard let last = history.first, let end = last.endedAt else { return "No walks yet" }
        let hours = Int(max(0, now.timeIntervalSince(end)) / 3600)
        return hours == 0 ? "Last walk just now" : "Last walk \(hours)h ago"
    }
    static var walkCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        calendar.firstWeekday = 2
        return calendar
    }
}
/// In-memory server seam shared by device clients. Production persists this
/// active record and history atomically, then publishes the resulting snapshot.
@MainActor @Observable final class MockWalkBackend {
    private(set) var activeWalk: DogWalk?
    private(set) var history: [DogWalk]
    private var sequence = 0
    init(now: Date, fixtures: Bool = true) {
        let calendar = MockWalkProvider.walkCalendar
        history = fixtures ? (0..<21).filter { $0 != 8 && $0 != 15 }.map { day in
            let end = calendar.date(byAdding: .day, value: -day, to: now.addingTimeInterval(-3 * 3600))!
            let minutes = day == 0 ? 32 : [28, 42, 35, 24, 48, 31, 38][day % 7]
            return DogWalk(id: "walk_fixture_\(day)", startedAt: end.addingTimeInterval(-Double(minutes) * 60), endedAt: end, startedBy: .iPhone)
        } : []
    }
    func start(at date: Date, device: WalkDevice) {
        guard activeWalk == nil else { return }
        sequence += 1
        activeWalk = DogWalk(id: "walk_session_\(sequence)", startedAt: date, endedAt: nil, startedBy: device)
    }
    func stop(at date: Date) {
        guard let walk = activeWalk else { return }
        history.insert(DogWalk(id: walk.id, startedAt: walk.startedAt, endedAt: max(date, walk.startedAt), startedBy: walk.startedBy), at: 0)
        activeWalk = nil
    }
}
/// Observation follows the shared backend so a remote command invalidates every
/// client's UI. There is deliberately no per-device elapsed counter.
@MainActor @Observable final class MockWalkProvider: WalkProvider {
    let backend: MockWalkBackend
    let device: WalkDevice
    var activeWalk: DogWalk? { backend.activeWalk }
    var history: [DogWalk] { backend.history }
    init(now: Date, fixtures: Bool = true, device: WalkDevice = .iPad, backend: MockWalkBackend? = nil) {
        self.backend = backend ?? MockWalkBackend(now: now, fixtures: fixtures)
        self.device = device
    }
    func start(at date: Date) { backend.start(at: date, device: device) }
    func stop(at date: Date) { backend.stop(at: date) }
    func simulateRemoteStart(at date: Date, device: WalkDevice = .iPhone) {
        backend.start(at: date, device: device)
    }
    func simulateRemoteStop(at date: Date) { backend.stop(at: date) }
}
func walkElapsed(_ seconds: TimeInterval) -> String {
    let seconds = Int(max(0, seconds))
    return seconds >= 3600 ? String(format: "%d:%02d:%02d", seconds / 3600, seconds / 60 % 60, seconds % 60) : String(format: "%d:%02d", seconds / 60, seconds % 60)
}
