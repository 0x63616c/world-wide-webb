import Foundation
import Observation
import UIKit

@MainActor protocol HomeDataSource: AnyObject, Observable {
    func status(for module: HomeModule) -> HomeModuleStatus
    var lamps: LampState { get }
    var climate: ClimateState { get }
    var wifi: WifiState { get }
    var weather: WeatherState { get }
    var tesla: any TeslaProvider { get }
    var calendar: any CalendarProvider { get }
    var photos: any PhotosProvider { get }
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
        if walks.activeWalk == nil { walks.start(at: now) } else { walks.stop(at: now) }
        walkActivity.synchronize(walk: walks.activeWalk, now: now)
    }
    func upcomingAlarm(at date: Date) -> UpcomingAlarm? {
        let scheduled = alarms.compactMap { alarm in
            alarm.next(after: date).map {
                UpcomingAlarm(alarm: alarm, due: $0, ringing: false, version: nil, snoozed: false)
            }
        }
        if let occurrence, occurrence.isRinging(at: date) {
            return UpcomingAlarm(
                alarm: occurrence.alarm, due: occurrence.due, ringing: true, version: occurrence.version, snoozed: false
            )
        }
        var candidates = scheduled
        if let occurrence {
            candidates.append(
                UpcomingAlarm(
                    alarm: occurrence.alarm, due: occurrence.due, ringing: false, version: occurrence.version,
                    snoozed: occurrence.snoozed))
        }
        return candidates.min { $0.due < $1.due }
    }
}
@MainActor @Observable final class MockHomeDataSource: HomeDataSource {
    func status(for module: HomeModule) -> HomeModuleStatus { .live }
    private(set) var lamps = LampState()
    private(set) var climate = ClimateState()
    private(set) var wifi = WifiState()
    let weather = WeatherState()
    let tesla: any TeslaProvider = MockTeslaProvider()
    let calendar: any CalendarProvider = MockCalendarProvider()
    let photos: any PhotosProvider = MockPhotosProvider()
    let walks: any WalkProvider
    let walkActivity = WalkLiveActivityManager()
    private(set) var alarms = [
        Alarm(id: 1, label: "Morning", time: "07:00", repeatDays: [1, 2, 3, 4, 5]),
        Alarm(id: 2, label: "Weekend", time: "09:00", repeatDays: [0, 6], enabled: false),
    ]
    private(set) var rooms = [
        SoundRoom(name: "Living Room", rawVolume: 24, baseline: 60, coordinator: "Desk", playing: true),
        SoundRoom(name: "Desk", rawVolume: 32, baseline: 80, coordinator: "Desk", playing: true),
        SoundRoom(name: "Bedroom", rawVolume: 18, baseline: 50, coordinator: "Bedroom", playing: false),
        SoundRoom(name: "Bathroom", rawVolume: 14, baseline: 40, coordinator: "Bathroom", playing: false),
        SoundRoom(name: "Kitchen", rawVolume: 20, baseline: 50, coordinator: "Kitchen", playing: false),
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
    init(
        latency: Duration = .milliseconds(150), wifiFixture: String = "secured", mode: ClimateMode = .cool,
        fixedNow: Date? = nil, ringing: Bool = false, groupedSonosPlaying: Bool? = nil
    ) {
        self.latency = latency
        self.fixedNow = fixedNow
        let device: WalkDevice = UIDevice.current.userInterfaceIdiom == .phone ? .iPhone : .iPad
        let walks = MockWalkProvider(
            now: fixedNow ?? ISO8601DateFormatter().date(from: "2026-10-29T22:41:00Z")!, device: device)
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
        if let groupedSonosPlaying {
            for i in rooms.indices where rooms[i].name != "Living Room" {
                rooms[i].coordinator = "Desk"
                rooms[i].sourceKind = .lineIn
                rooms[i].sourceLabel = "Line-in"
                rooms[i].playing = groupedSonosPlaying
            }
            if let tv = rooms.firstIndex(where: { $0.name == "Living Room" }) {
                rooms[tv].coordinator = rooms[tv].id
                rooms[tv].sourceKind = .tv
                rooms[tv].sourceLabel = "TV"
            }
        }
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
            climate.fanOn = mode == "on"
            climate.selectedFanMode = mode
            climate.reportedFanLabel = mode.capitalized
            markPending("fan")
        case .fan(let on):
            climate.fanOn = on
            climate.selectedFanMode = on ? "on" : "auto"
            climate.reportedFanLabel = nil
            markPending("fan")
        case .toggle(let key):
            if key == .fan {
                climate.fanOn.toggle()
                climate.selectedFanMode = climate.fanOn ? "on" : "auto"
                climate.reportedFanLabel = nil
                markPending("fan")
                return
            }
            let on = !lamps.isOn(key)
            switch key {
            case .all:
                lamps.on = Array(repeating: on, count: 8)
                lamps.ceiling = on
                lamps.cabinet = on
            case .lamps: lamps.on = Array(repeating: on, count: 8)
            case .bedroom: for i in 0..<3 { lamps.on[i] = on }
            case .livingRoom: for i in 3..<8 { lamps.on[i] = on }
            case .lights:
                lamps.ceiling = on
                lamps.cabinet = on
            case .ceiling: lamps.ceiling = on
            case .cabinet: lamps.cabinet = on
            case .fan: break
            }
            if !lamps.anyOn { lamps.party = .off }
            markPending(key.rawValue)
        case .brightness(let value):
            guard lamps.anyOn else { return }
            lamps.brightness = min(100, max(0, value))
            lamps.on = Array(repeating: true, count: 8)
            markPending("brightness")
        case .kelvin(let value):
            guard lamps.anyOn else { return }
            lamps.kelvin = min(6500, max(2000, Int((Double(value) / 100).rounded()) * 100))
            lamps.scene = "White"
            lamps.activeColor = nil
            lamps.party = .off
            lamps.on = Array(repeating: true, count: 8)
            markPending("kelvin")
        case .scene(let value):
            guard ["White", "Mood"].contains(value) else { return }
            lamps.scene = value
            lamps.activeColor = nil
            lamps.party = .off
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
            lamps.brightness = 100
            lamps.activeColor = slot
            lamps.scene = "Custom \(slot + 1)"
            lamps.party = .off
            lamps.on = Array(repeating: true, count: 8)
            lamps.lampColors = Array(repeating: lamps.colors[slot], count: 8)
            markPending("color")
        case .party(let speed):
            guard lamps.anyOn else { return }
            lamps.party = speed
            lamps.activeColor = nil
            markPending("party")
        case .mode(let mode):
            climate.mode = mode
            markPending("climate")
        case .target(let value):
            guard climate.mode == .cool || climate.mode == .heat else { return }
            climate.target = min(77, max(67, value))
            markPending("climate")
        case .low(let value):
            climate.low = min(climate.high - 2, max(67, value))
            markPending("climate")
        case .high(let value):
            climate.high = max(climate.low + 2, min(77, value))
            markPending("climate")
        case .shiftRange(let delta):
            let step = min(77 - climate.high, max(67 - climate.low, delta))
            climate.low += step
            climate.high += step
            markPending("climate")
        case .saveAlarm(var alarm):
            guard alarm.validationError == nil else { return }
            if !alarm.date.isEmpty { alarm.repeatDays = [] }
            if let index = alarms.firstIndex(where: { $0.id == alarm.id }) {
                alarms[index] = alarm
            } else {
                alarm.id = nextAlarmID
                nextAlarmID += 1
                alarms.append(alarm)
            }
            markPending("alarms")
        case .deleteAlarm(let id):
            alarms.removeAll { $0.id == id }
            markPending("alarms")
        case .enableAlarm(let id, let enabled):
            if let i = alarms.firstIndex(where: { $0.id == id }) { alarms[i].enabled = enabled }
            markPending("alarms")
        case .snoozeAlarm(let id, let version):
            guard var active = occurrence, active.alarm.id == id, active.version == version,
                active.isRinging(at: now), let minutes = Int(active.alarm.snoozeMinutes), (1...60).contains(minutes)
            else { return }
            active.due = now.addingTimeInterval(Double(minutes * 60))
            active.version += 1
            active.snoozed = true
            occurrence = active
            markPending("alarms")
        case .stopAlarm(let id, let version):
            guard let active = occurrence, active.alarm.id == id, active.version == version, active.isRinging(at: now)
            else { return }
            occurrence = nil
            markPending("alarms")
        case .transport(let id, let command):
            guard let room = rooms.first(where: { $0.id == id }) else { return }
            for i in rooms.indices where rooms[i].coordinator == room.coordinator {
                rooms[i].positionSeconds = rooms[i].position(at: now)
                rooms[i].positionUpdatedAt = now
                switch command {
                case .play: rooms[i].playing = true
                case .pause: rooms[i].playing = false
                case .next:
                    rooms[i].trackIndex = (rooms[i].trackIndex + 1) % FixtureTrack.queue.count
                    rooms[i].positionSeconds = 0
                case .previous:
                    rooms[i].trackIndex =
                        (rooms[i].trackIndex + FixtureTrack.queue.count - 1) % FixtureTrack.queue.count
                    rooms[i].positionSeconds = 0
                }
            }
            markPending("sound")
        case .seek(let id, let seconds):
            guard seconds.isFinite, let room = rooms.first(where: { $0.id == id }), room.durationSeconds > 0 else {
                return
            }
            for i in rooms.indices where rooms[i].coordinator == room.coordinator {
                rooms[i].positionSeconds = min(rooms[i].durationSeconds, max(0, seconds))
                rooms[i].positionUpdatedAt = now
            }
            markPending("sound")
        case .rawVolume(let id, let value):
            guard let i = rooms.firstIndex(where: { $0.id == id }) else { return }
            rooms[i].rawVolume = min(100, max(0, value))
            markPending("sound")
        case .roomVolumes(let levels):
            for i in rooms.indices {
                if let level = levels[rooms[i].id] { rooms[i].rawVolume = min(100, max(0, level)) }
            }
            markPending("sound")
        case .volume(let id, let value):
            guard let room = rooms.first(where: { $0.id == id }) else { return }
            let display = min(100, max(0, value))
            for i in rooms.indices
            where globalLock || rooms[i].id == id || (groupLock && rooms[i].coordinator == room.coordinator) {
                rooms[i].rawVolume = min(
                    100, max(0, Int((Double(display) * Double(rooms[i].baseline ?? 100) / 100).rounded())))
            }
            markPending("sound")
        case .mute(let id):
            if let i = rooms.firstIndex(where: { $0.id == id }) { rooms[i].muted.toggle() }
            markPending("sound")
        case .globalLock: globalLock.toggle()
        case .groupLock: groupLock.toggle()
        case .calibrate:
            for i in rooms.indices where rooms[i].rawVolume > 0 { rooms[i].baseline = rooms[i].rawVolume * 2 }
            markPending("sound")
        case .clearCalibration:
            for i in rooms.indices { rooms[i].baseline = nil }
            globalLock = false
            markPending("sound")
        case .joinAll(let name):
            guard rooms.contains(where: { $0.name == name }) else { return }
            let leader = rooms.first { $0.name == name }!
            for i in rooms.indices {
                rooms[i].coordinator = name
                copyPlayback(from: leader, to: i)
            }
            markPending("sound")
        case .join(let id, let coordinator):
            guard let leader = rooms.first(where: { $0.name == coordinator }),
                let i = rooms.firstIndex(where: { $0.id == id })
            else { return }
            guard rooms[i].coordinator != leader.coordinator else { return }
            detachCoordinator(id)
            rooms[i].coordinator = leader.coordinator
            copyPlayback(from: leader, to: i)
            markPending("sound")
        case .leave(let id):
            guard let i = rooms.firstIndex(where: { $0.id == id }) else { return }
            detachCoordinator(id)
            rooms[i].coordinator = id
            rooms[i].positionSeconds = rooms[i].position(at: now)
            rooms[i].positionUpdatedAt = now
            rooms[i].playing = false
            markPending("sound")
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
