import Foundation
#if os(iOS)
import UIKit
#endif
import Observation

// Presentation models default to fixtures for the prototype; live hosts inject values.
// No device discovery, credentials, or networking belongs in these models.
enum Accessory: String, CaseIterable, Identifiable {
    case all, fan, lamps, bedroom, livingRoom, lights, ceiling, cabinet
    var id: String { rawValue }
    var name: String {
        switch self {
        case .all: "All"
        case .fan: "Fan"
        case .lamps: "Lamps"
        case .bedroom: "Bedroom"
        case .livingRoom: "Living Room"
        case .lights: "Lights"
        case .ceiling: "Ceiling"
        case .cabinet: "Under Cabinet"
        }
    }
    var symbol: String {
        switch self {
        case .all: "bolt.fill"
        case .fan: "fan.fill"
        case .lamps, .bedroom, .livingRoom: "lamp.table.fill"
        case .lights: "lightbulb.fill"
        case .ceiling: "lamp.ceiling.fill"
        case .cabinet: "light.strip.2.fill"
        }
    }
}
enum ClimateMode: String, CaseIterable {
    case cool, heat, heatCool = "heat_cool", off
    var label: String {
        switch self { case .cool: "Cool"; case .heat: "Heat"; case .heatCool: "Heat·Cool"; case .off: "Off" }
    }
}
struct ClimateState {
    var mode: ClimateMode = .cool
    var target = 70
    var low = 68
    var high = 74
    var ambient = 72
    var fanOn = false
    var reportedFanLabel: String? = nil
    var reportedAction: String? = nil
    var fanModes: [String] = ["auto", "on"]
    var selectedFanMode: String? = nil
    var fanLabel: String { reportedFanLabel ?? (mode == .off ? "Off" : fanOn ? "On" : "Auto") }
    var action: String {
        if let reportedAction { return reportedAction }
        return switch mode {
        case .off: "Idle"
        case .cool: ambient > target ? "Cooling" : "Idle"
        case .heat: ambient < target ? "Heating" : "Idle"
        case .heatCool: ambient > high ? "Cooling" : ambient < low ? "Heating" : "Idle"
        }
    }
}
enum PartySpeed: String, CaseIterable {
    case off = "Off", slow = "Slow", medium = "Med", fast = "Fast"
    var interval: TimeInterval? {
        switch self { case .off: nil; case .slow: 16; case .medium: 8; case .fast: 4 }
    }
}
struct LampState {
    // Same membership as Controls. Kitchen Lamp deliberately belongs to Living Room.
    static let names = ["Bed Left", "Bed Right", "Mirror", "Globe", "Corner Lamp", "Floor Lamp", "Desk", "Kitchen Lamp"]
    var on = [true, true, true, false, false, false, false, false]
    var ceiling = false
    var cabinet = true
    var brightness = 65
    var kelvin = 2700
    var scene = "White"
    var colors = ["#ff0000", "#0066ff", "#8b5cf6"]
    var activeColor: Int?
    var party: PartySpeed = .off
    var lampColors = Array(repeating: "#ffe0b2", count: 8)
    var anyOn: Bool { on.contains(true) }
    static func members(_ key: Accessory) -> Range<Int> {
        switch key {
        case .bedroom: 0..<3
        case .livingRoom: 3..<names.count
        case .lamps: 0..<names.count
        default: 0..<0
        }
    }
    func onCount(_ key: Accessory = .lamps) -> Int {
        Self.members(key).count { on[$0] }
    }
    func countLabel(_ key: Accessory = .lamps) -> String {
        let count = onCount(key)
        return "\(count) \(count == 1 ? "lamp" : "lamps") on"
    }
    func isOn(_ key: Accessory) -> Bool {
        switch key {
        case .all: on.allSatisfy { $0 } && ceiling && cabinet
        case .lamps: anyOn
        case .bedroom, .livingRoom: onCount(key) > 0
        case .lights: ceiling || cabinet
        case .ceiling: ceiling
        case .cabinet: cabinet
        case .fan: false // Fan belongs to ClimateState.
        }
    }
}
struct WifiState {
    var ssid: String? = "WWW-Guest"
    var password: String? = "fixture-password-123"
    static let open = WifiState(ssid: "WWW-Guest", password: nil)
    static let unconfigured = WifiState(ssid: nil, password: nil)
}
struct HourForecast: Identifiable {
    let id: Int
    let time: String
    let temperature: Int
    let feels: Int
    let symbol: String
}
struct WeatherState {
    var city = "San Francisco"
    var temperature = 64
    var condition = "Partly cloudy"
    var symbol = "cloud.sun.fill"
    var high = 67
    var low = 56
    var feels = 63
    var humidity = 72
    var wind = 8
    var solarLabel = "Sunset"
    var solarValue = "6:14 PM"
    var hours: [HourForecast] = (0..<12).map { index in
        HourForecast(id: index, time: ["11a", "12p", "1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p", "10p"][index],
                     temperature: [64, 63, 62, 61, 60, 59, 58, 58, 57, 57, 56, 56][index],
                     feels: [63, 62, 60, 59, 58, 57, 56, 56, 55, 55, 54, 54][index],
                     symbol: index < 7 ? "cloud.sun.fill" : "cloud.moon.fill")
    }
}
struct Alarm: Identifiable, Equatable {
    // Stable in-memory fixture IDs, never sent to the production API.
    var id: Int = 0
    var label = "Alarm"
    var time = "07:00"
    var date = ""
    var timeZone = "America/Los_Angeles"
    var repeatDays: Set<Int> = []
    var snoozeMinutes = "9"
    var lightTarget = ""
    var enabled = true
    var validationError: String? {
        if label.trimmingCharacters(in: .whitespaces).isEmpty || label.count > 80 { return "Use a label of 1–80 characters." }
        if time.range(of: #"^([01]\d|2[0-3]):[0-5]\d$"#, options: .regularExpression) == nil { return "Use a time such as 07:00." }
        if TimeZone(identifier: timeZone) == nil { return "Use an IANA time zone, such as America/Los_Angeles." }
        if !snoozeMinutes.isEmpty && !(1...60).contains(Int(snoozeMinutes) ?? 0) { return "Snooze must be 1–60 minutes." }
        if !lightTarget.isEmpty && lightTarget.range(of: #"^(scene\.[a-z0-9_]+|(?:light|switch)\.[a-z0-9_]+(?:,(?:light|switch)\.[a-z0-9_]+)*)$"#, options: .regularExpression) == nil { return "Use a scene entity or comma-separated light/switch entities." }
        if !date.isEmpty && exactDate == nil { return "Use a valid YYYY-MM-DD date and a time that exists in this time zone." }
        return nil
    }
    var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: timeZone) ?? .gmt
        return c
    }
    var exactDate: Date? {
        let f = DateFormatter()
        f.calendar = calendar; f.timeZone = calendar.timeZone
        f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd HH:mm"; f.isLenient = false
        guard let parsed = f.date(from: "\(date) \(time)"), f.string(from: parsed) == "\(date) \(time)" else { return nil }
        return parsed
    }
    func next(after now: Date) -> Date? {
        guard enabled, validationError == nil else { return nil }
        if !date.isEmpty { return exactDate.flatMap { $0 > now ? $0 : nil } }
        let fields = time.split(separator: ":").compactMap { Int($0) }
        guard fields.count == 2 else { return nil }
        return (0...7).compactMap { offset -> Date? in
            guard let day = calendar.date(byAdding: .day, value: offset, to: now) else { return nil }
            if !repeatDays.isEmpty && !repeatDays.contains(calendar.component(.weekday, from: day) - 1) { return nil }
            var parts = calendar.dateComponents([.year, .month, .day], from: day)
            parts.hour = fields[0]; parts.minute = fields[1]
            guard let result = calendar.date(from: parts), result > now,
                  calendar.component(.hour, from: result) == fields[0] else { return nil }
            return result
        }.min()
    }
}
enum SonosTransport: String { case play, pause, next, previous }
enum SoundSource: String { case spotify, airplay, tv, lineIn = "line-in", other, idle }
struct FixtureTrack: Equatable {
    let title: String
    let artist: String
    let tint: String
    // Authored fixture names; the artwork is drawn in SwiftUI.
    static let queue = [
        FixtureTrack(title: "Closer to the Sun", artist: "The Evening Hours", tint: "#8f456e"),
        FixtureTrack(title: "After the Rain", artist: "The Evening Hours", tint: "#485c85"),
        FixtureTrack(title: "Soft Focus", artist: "The Evening Hours", tint: "#a56a3d")
    ]
}
struct AlarmOccurrence: Equatable {
    let alarm: Alarm
    var due: Date
    var version = 0
    var snoozed = false
    func isRinging(at now: Date) -> Bool { due <= now }
}
struct UpcomingAlarm {
    let alarm: Alarm
    let due: Date
    let ringing: Bool
    let version: Int?
    let snoozed: Bool
    func remaining(at now: Date) -> TimeInterval { max(0, due.timeIntervalSince(now)) }
    // One day around the perimeter. Longer schedules remain full until the final day.
    func ringFraction(at now: Date) -> Double { min(1, remaining(at: now) / 86_400) }
}
struct SoundRoom: Identifiable {
    /// nil preserves prototype fixtures; a supplied value (including nil metadata)
    /// is authoritative for live rooms and keeps identity separate from display names.
    struct Metadata {
        let id: String
        let title: String?
        let artist: String?
        var coordinatorName: String? = nil
        var tint: String = "#303030"
    }
    var metadata: Metadata? = nil
    var id: String { metadata?.id ?? name }
    let name: String
    var rawVolume: Int
    var baseline: Int?
    var muted = false
    var coordinator: String
    var playing: Bool
    var trackIndex = 0
    var positionSeconds: Double = 107
    var durationSeconds: Double = 232
    var positionUpdatedAt: Date = .distantPast
    func position(at date: Date) -> Double {
        min(durationSeconds, max(0, positionSeconds + (playing ? max(0, date.timeIntervalSince(positionUpdatedAt)) : 0)))
    }
    var sourceKind: SoundSource = .spotify
    var sourceLabel: String? = "Spotify"
    var albumArtUri: String? = nil
    var trackTitle: String? {
        if let metadata { return metadata.title }
        return sourceKind == .idle ? nil : FixtureTrack.queue[trackIndex].title
    }
    var trackArtist: String? {
        if let metadata { return metadata.artist }
        return sourceKind == .idle ? nil : FixtureTrack.queue[trackIndex].artist
    }
    var artworkTint: String { metadata?.tint ?? FixtureTrack.queue[trackIndex].tint }
    var coordinatorLabel: String {
        if let metadata { return metadata.coordinatorName ?? "Unavailable" }
        return coordinator
    }
    var transportState: String { playing ? "PLAYING" : "PAUSED_PLAYBACK" }
    var displayVolume: Int { baseline.map { $0 > 0 ? Int((Double(rawVolume) / Double($0) * 100).rounded()) : rawVolume } ?? rawVolume }
}
enum HomeCommand {
    case fan(Bool)
    case fanMode(String)
    case toggle(Accessory), brightness(Int), kelvin(Int), scene(String), color(Int, String?), party(PartySpeed)
    case mode(ClimateMode), target(Int), low(Int), high(Int), shiftRange(Int)
    case saveAlarm(Alarm), deleteAlarm(Int), enableAlarm(Int, Bool)
    case snoozeAlarm(Int, Int), stopAlarm(Int, Int)
    case playMedia(String, Int)
    case transport(String, SonosTransport), seek(String, Double), rawVolume(String, Int)
    case volume(String, Int), mute(String), globalLock, groupLock, calibrate, clearCalibration, joinAll(String), join(String, String), leave(String)
}
@MainActor protocol HomeDataSource: AnyObject, Observable {
    var lamps: LampState { get }
    var climate: ClimateState { get }
    var wifi: WifiState { get }
    var weather: WeatherState { get }
    var tesla: any TeslaProvider { get }
    var calendar: any CalendarProvider { get }
    var photos: any PhotosProvider { get }
    var cameras: any CamerasProvider { get }
    var media: any MediaProvider { get }
    var walks: any WalkProvider { get }
    var walkActivity: WalkLiveActivityManager { get }
    var alarms: [Alarm] { get }
    var occurrence: AlarmOccurrence? { get }
    var rooms: [SoundRoom] { get }
    var globalLock: Bool { get }
    var groupLock: Bool { get }
    var pending: Set<String> { get }
    var now: Date { get }
    func send(_ command: HomeCommand)
    func upcomingAlarm(at date: Date) -> UpcomingAlarm?
}
extension HomeDataSource {
    func toggleWalk() {
        if walks.activeWalk == nil { walks.start(at: now) }
        else { walks.stop(at: now) }
        walkActivity.synchronize(walk: walks.activeWalk, now: now)
    }
    func upcomingAlarm(at date: Date) -> UpcomingAlarm? {
        let scheduled = alarms.compactMap { alarm in
            alarm.next(after: date).map { UpcomingAlarm(alarm: alarm, due: $0, ringing: false, version: nil, snoozed: false) }
        }
        if let occurrence, occurrence.isRinging(at: date) {
            return UpcomingAlarm(alarm: occurrence.alarm, due: occurrence.due, ringing: true, version: occurrence.version, snoozed: false)
        }
        var candidates = scheduled
        if let occurrence {
            candidates.append(UpcomingAlarm(alarm: occurrence.alarm, due: occurrence.due, ringing: false, version: occurrence.version, snoozed: occurrence.snoozed))
        }
        return candidates.min { $0.due < $1.due }
    }
}
@MainActor @Observable final class MockHomeDataSource: HomeDataSource {
    private(set) var lamps = LampState()
    private(set) var climate = ClimateState()
    private(set) var wifi = WifiState()
    let weather = WeatherState()
    let tesla: any TeslaProvider = MockTeslaProvider()
    let calendar: any CalendarProvider = MockCalendarProvider()
    let photos: any PhotosProvider = MockPhotosProvider()
    let cameras: any CamerasProvider = MockCamerasProvider()
    let media: any MediaProvider = MockMediaProvider()
    let walks: any WalkProvider
    let walkActivity = WalkLiveActivityManager()
    private(set) var alarms = [Alarm(id: 1, label: "Morning", time: "07:00", repeatDays: [1,2,3,4,5]), Alarm(id: 2, label: "Weekend", time: "09:00", repeatDays: [0,6], enabled: false)]
    private(set) var rooms = [
        SoundRoom(name: "Living Room", rawVolume: 24, baseline: 60, coordinator: "Desk", playing: true),
        SoundRoom(name: "Desk", rawVolume: 32, baseline: 80, coordinator: "Desk", playing: true),
        SoundRoom(name: "Bedroom", rawVolume: 18, baseline: 50, coordinator: "Bedroom", playing: false),
        SoundRoom(name: "Bathroom", rawVolume: 14, baseline: 40, coordinator: "Bathroom", playing: false),
        SoundRoom(name: "Kitchen", rawVolume: 20, baseline: 50, coordinator: "Kitchen", playing: false)
    ]
    private(set) var occurrence: AlarmOccurrence?
    private(set) var globalLock = false
    private(set) var groupLock = false
    private(set) var pending: Set<String> = []
    private var generations: [String: Int] = [:]
    private var nextAlarmID = 3
    private let latency: Duration
    private let launched = Date()
    private let fixtureDate = ISO8601DateFormatter().date(from: "2026-10-29T22:41:00Z")!
    private let fixedNow: Date?
    var now: Date { fixedNow ?? fixtureDate.addingTimeInterval(Date().timeIntervalSince(launched)) }
    init(latency: Duration = .milliseconds(150), wifiFixture: String = "secured", mode: ClimateMode = .cool, fixedNow: Date? = nil, ringing: Bool = false) {
        self.latency = latency
        self.fixedNow = fixedNow
        #if os(iOS)
        let device: WalkDevice = UIDevice.current.userInterfaceIdiom == .phone ? .iPhone : .iPad
        #else
        let device: WalkDevice = .mac
        #endif
        let walks = MockWalkProvider(now: fixedNow ?? ISO8601DateFormatter().date(from: "2026-10-29T22:41:00Z")!, device: device)
        self.walks = walks
        if ProcessInfo.processInfo.arguments.contains("-walkStartedRemotely") {
            walks.simulateRemoteStart(at: now.addingTimeInterval(-724))
        }
        if ProcessInfo.processInfo.arguments.contains("-walkRunning") { walks.start(at: now.addingTimeInterval(-754)) }
        if ringing { occurrence = AlarmOccurrence(alarm: alarms[0], due: fixedNow ?? fixtureDate) }
        if wifiFixture == "open" { wifi = .open }
        if wifiFixture == "unconfigured" { wifi = .unconfigured }
        climate.mode = mode
        for i in rooms.indices { rooms[i].positionUpdatedAt = now }
    }
    private func markPending(_ key: String) {
        let generation = (generations[key] ?? 0) + 1
        generations[key] = generation
        pending.insert(key)
        Task { [weak self, latency] in
            try? await Task.sleep(for: latency)
            guard let self, self.generations[key] == generation else { return }
            self.pending.remove(key)
        }
    }
    func send(_ command: HomeCommand) {
        switch command {
        case .fanMode(let mode):
            climate.fanOn = mode == "on"; climate.selectedFanMode = mode
            climate.reportedFanLabel = mode.capitalized; markPending("fan")
        case .fan(let on):
            climate.fanOn = on; climate.selectedFanMode = on ? "on" : "auto"
            climate.reportedFanLabel = nil; markPending("fan")
        case .toggle(let key):
            if key == .fan {
                climate.fanOn.toggle(); climate.selectedFanMode = climate.fanOn ? "on" : "auto"
                climate.reportedFanLabel = nil; markPending("fan"); return
            }
            let on = !lamps.isOn(key)
            switch key {
            case .all: lamps.on = Array(repeating: on, count: 8); lamps.ceiling = on; lamps.cabinet = on
            case .lamps: lamps.on = Array(repeating: on, count: 8)
            case .bedroom: for i in 0..<3 { lamps.on[i] = on }
            case .livingRoom: for i in 3..<8 { lamps.on[i] = on }
            case .lights: lamps.ceiling = on; lamps.cabinet = on
            case .ceiling: lamps.ceiling = on
            case .cabinet: lamps.cabinet = on
            case .fan: break
            }
            if !lamps.anyOn { lamps.party = .off }
            markPending(key.rawValue)
        case .brightness(let value):
            guard lamps.anyOn else { return }; lamps.brightness = min(100, max(0, value)); lamps.on = Array(repeating: true, count: 8); markPending("brightness")
        case .kelvin(let value):
            guard lamps.anyOn else { return }; lamps.kelvin = min(6500, max(2000, Int((Double(value) / 100).rounded()) * 100)); lamps.scene = "White"; lamps.activeColor = nil; lamps.party = .off; lamps.on = Array(repeating: true, count: 8); markPending("kelvin")
        case .scene(let value):
            guard ["White", "Mood"].contains(value) else { return }
            lamps.scene = value; lamps.activeColor = nil; lamps.party = .off
            lamps.on = Array(repeating: true, count: 8)
            if value == "Mood" {
                let colors = ["#a855f7", "#3b82f6", "#ec4899", "#f59e0b", "#14b8a6", "#ef4444", "#6366f1", "#84cc16"]
                lamps.lampColors = fixedNow == nil ? colors.shuffled() : colors
            }
            markPending("scene")
        case .color(let slot, let hex):
            guard lamps.colors.indices.contains(slot) else { return }
            if let hex {
                guard hex.range(of: "^#[0-9A-Fa-f]{6}$", options: .regularExpression) != nil else { return }
                lamps.colors[slot] = hex.lowercased()
            }
            lamps.brightness = 100; lamps.activeColor = slot; lamps.scene = "Custom \(slot + 1)"; lamps.party = .off
            lamps.on = Array(repeating: true, count: 8); lamps.lampColors = Array(repeating: lamps.colors[slot], count: 8)
            markPending("color")
        case .party(let speed):
            guard lamps.anyOn else { return }; lamps.party = speed; lamps.activeColor = nil; markPending("party")
        case .mode(let mode): climate.mode = mode; markPending("climate")
        case .target(let value):
            guard climate.mode == .cool || climate.mode == .heat else { return }
            climate.target = min(77, max(67, value)); markPending("climate")
        case .low(let value): climate.low = min(climate.high - 2, max(67, value)); markPending("climate")
        case .high(let value): climate.high = max(climate.low + 2, min(77, value)); markPending("climate")
        case .shiftRange(let delta):
            let step = min(77 - climate.high, max(67 - climate.low, delta))
            climate.low += step; climate.high += step; markPending("climate")
        case .saveAlarm(var alarm):
            guard alarm.validationError == nil else { return }
            if !alarm.date.isEmpty { alarm.repeatDays = [] }
            if let index = alarms.firstIndex(where: { $0.id == alarm.id }) { alarms[index] = alarm }
            else { alarm.id = nextAlarmID; nextAlarmID += 1; alarms.append(alarm) }
            markPending("alarms")
        case .deleteAlarm(let id): alarms.removeAll { $0.id == id }; markPending("alarms")
        case .enableAlarm(let id, let enabled):
            if let i = alarms.firstIndex(where: { $0.id == id }) { alarms[i].enabled = enabled }; markPending("alarms")
        case .snoozeAlarm(let id, let version):
            guard var active = occurrence, active.alarm.id == id, active.version == version,
                  active.isRinging(at: now), let minutes = Int(active.alarm.snoozeMinutes), (1...60).contains(minutes) else { return }
            active.due = now.addingTimeInterval(Double(minutes * 60)); active.version += 1; active.snoozed = true
            occurrence = active; markPending("alarms")
        case .stopAlarm(let id, let version):
            guard let active = occurrence, active.alarm.id == id, active.version == version, active.isRinging(at: now) else { return }
            occurrence = nil; markPending("alarms")
        case .playMedia(let id, let trackIndex):
            guard FixtureTrack.queue.indices.contains(trackIndex), let room = rooms.first(where: { $0.id == id }) else { return }
            for i in rooms.indices where rooms[i].coordinator == room.coordinator {
                rooms[i].trackIndex = trackIndex; rooms[i].playing = true
                rooms[i].sourceKind = .other; rooms[i].sourceLabel = "Fixture library"
                rooms[i].positionSeconds = 0; rooms[i].positionUpdatedAt = now
            }; markPending("sound")
        case .transport(let id, let command):
            guard let room = rooms.first(where: { $0.id == id }) else { return }
            for i in rooms.indices where rooms[i].coordinator == room.coordinator {
                rooms[i].positionSeconds = rooms[i].position(at: now)
                rooms[i].positionUpdatedAt = now
                switch command {
                case .play: rooms[i].playing = true
                case .pause: rooms[i].playing = false
                case .next: rooms[i].trackIndex = (rooms[i].trackIndex + 1) % FixtureTrack.queue.count; rooms[i].positionSeconds = 0
                case .previous: rooms[i].trackIndex = (rooms[i].trackIndex + FixtureTrack.queue.count - 1) % FixtureTrack.queue.count; rooms[i].positionSeconds = 0
                }
            }; markPending("sound")
        case .seek(let id, let seconds):
            guard seconds.isFinite, let room = rooms.first(where: { $0.id == id }), room.durationSeconds > 0 else { return }
            for i in rooms.indices where rooms[i].coordinator == room.coordinator {
                rooms[i].positionSeconds = min(rooms[i].durationSeconds, max(0, seconds))
                rooms[i].positionUpdatedAt = now
            }; markPending("sound")
        case .rawVolume(let id, let value):
            guard let i = rooms.firstIndex(where: { $0.id == id }) else { return }
            rooms[i].rawVolume = min(100, max(0, value)); markPending("sound")
        case .volume(let id, let value):
            guard let room = rooms.first(where: { $0.id == id }) else { return }
            let display = min(100, max(0, value))
            for i in rooms.indices where globalLock || rooms[i].id == id || (groupLock && rooms[i].coordinator == room.coordinator) {
                rooms[i].rawVolume = min(100, max(0, Int((Double(display) * Double(rooms[i].baseline ?? 100) / 100).rounded())))
            }; markPending("sound")
        case .mute(let id): if let i = rooms.firstIndex(where: { $0.id == id }) { rooms[i].muted.toggle() }; markPending("sound")
        case .globalLock: globalLock.toggle()
        case .groupLock: groupLock.toggle()
        case .calibrate: for i in rooms.indices where rooms[i].rawVolume > 0 { rooms[i].baseline = rooms[i].rawVolume * 2 }; markPending("sound")
        case .clearCalibration: for i in rooms.indices { rooms[i].baseline = nil }; globalLock = false; markPending("sound")
        case .joinAll(let name):
            guard rooms.contains(where: { $0.name == name }) else { return }
            let leader = rooms.first { $0.name == name }!
            for i in rooms.indices { rooms[i].coordinator = name; copyPlayback(from: leader, to: i) }; markPending("sound")
        case .join(let id, let coordinator):
            guard let leader = rooms.first(where: { $0.name == coordinator }), let i = rooms.firstIndex(where: { $0.id == id }) else { return }
            guard rooms[i].coordinator != leader.coordinator else { return }
            detachCoordinator(id)
            rooms[i].coordinator = leader.coordinator; copyPlayback(from: leader, to: i); markPending("sound")
        case .leave(let id):
            guard let i = rooms.firstIndex(where: { $0.id == id }) else { return }
            detachCoordinator(id); rooms[i].coordinator = id; rooms[i].positionSeconds = rooms[i].position(at: now); rooms[i].positionUpdatedAt = now; rooms[i].playing = false; markPending("sound")
        }
    }
    private func copyPlayback(from leader: SoundRoom, to index: Int) {
        rooms[index].positionSeconds = leader.position(at: now)
        rooms[index].durationSeconds = leader.durationSeconds
        rooms[index].positionUpdatedAt = now
        rooms[index].playing = leader.playing
        rooms[index].trackIndex = leader.trackIndex
        rooms[index].sourceKind = leader.sourceKind
        rooms[index].sourceLabel = leader.sourceLabel
        rooms[index].albumArtUri = leader.albumArtUri
    }
    private func detachCoordinator(_ id: String) {
        let followers = rooms.indices.filter { rooms[$0].coordinator == id && rooms[$0].id != id }
        if let first = followers.first {
            let successor = rooms[first].id
            for i in followers { rooms[i].coordinator = successor }
        }
    }
}
