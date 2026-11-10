import Foundation
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
    case cool, heat
    case heatCool = "heat_cool"
    case off
    static let selectable: [ClimateMode] = [.heat, .cool, .off]
    var label: String {
        switch self {
        case .cool: "Cool"
        case .heat: "Heat"
        case .heatCool: "Heat·Cool"
        case .off: "Off"
        }
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
    case off = "Off"
    case slow = "Slow"
    case medium = "Med"
    case fast = "Fast"
    var interval: TimeInterval? {
        switch self {
        case .off: nil
        case .slow: 16
        case .medium: 8
        case .fast: 4
        }
    }
}
struct LampState {
    // Same membership as Controls. Kitchen Lamp deliberately belongs to Living Room.
    static let names = [
        "Bed Left", "Bed Right", "Mirror", "Globe", "Corner Lamp", "Floor Lamp", "Desk", "Kitchen Lamp",
    ]
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
        case .fan: false  // Fan belongs to ClimateState.
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
    var sunrise: Date? = nil
    var sunset: Date? = nil
    var nextSunrise: Date? = nil
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
        HourForecast(
            id: index, time: ["11a", "12p", "1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p", "10p"][index],
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
        if label.trimmingCharacters(in: .whitespaces).isEmpty || label.count > 80 {
            return "Use a label of 1–80 characters."
        }
        if time.range(of: #"^([01]\d|2[0-3]):[0-5]\d$"#, options: .regularExpression) == nil {
            return "Use a time such as 07:00."
        }
        if TimeZone(identifier: timeZone) == nil { return "Use an IANA time zone, such as America/Los_Angeles." }
        if !snoozeMinutes.isEmpty && !(1...60).contains(Int(snoozeMinutes) ?? 0) {
            return "Snooze must be 1–60 minutes."
        }
        if !lightTarget.isEmpty
            && lightTarget.range(
                of: #"^(scene\.[a-z0-9_]+|(?:light|switch)\.[a-z0-9_]+(?:,(?:light|switch)\.[a-z0-9_]+)*)$"#,
                options: .regularExpression) == nil
        {
            return "Use a scene entity or comma-separated light/switch entities."
        }
        if !date.isEmpty && exactDate == nil {
            return "Use a valid YYYY-MM-DD date and a time that exists in this time zone."
        }
        return nil
    }
    var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: timeZone) ?? .gmt
        return c
    }
    var exactDate: Date? {
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd HH:mm"
        f.isLenient = false
        guard let parsed = f.date(from: "\(date) \(time)"), f.string(from: parsed) == "\(date) \(time)" else {
            return nil
        }
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
            parts.hour = fields[0]
            parts.minute = fields[1]
            guard let result = calendar.date(from: parts), result > now,
                calendar.component(.hour, from: result) == fields[0]
            else { return nil }
            return result
        }.min()
    }
}
enum SonosTransport: String { case play, pause, next, previous }
enum SoundSource: String {
    case spotify, airplay, tv
    case lineIn = "line-in"
    case other, idle
}
struct FixtureTrack: Equatable {
    let title: String
    let artist: String
    let tint: String
    // Authored fixture names; the artwork is drawn in SwiftUI.
    static let queue = [
        FixtureTrack(title: "Closer to the Sun", artist: "The Evening Hours", tint: "#8f456e"),
        FixtureTrack(title: "After the Rain", artist: "The Evening Hours", tint: "#485c85"),
        FixtureTrack(title: "Soft Focus", artist: "The Evening Hours", tint: "#a56a3d"),
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
    var reportedTransportState: String? = nil
    var trackIndex = 0
    var positionSeconds: Double = 107
    var durationSeconds: Double = 232
    var positionUpdatedAt: Date = .distantPast
    func position(at date: Date) -> Double {
        min(
            durationSeconds, max(0, positionSeconds + (playing ? max(0, date.timeIntervalSince(positionUpdatedAt)) : 0))
        )
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
    var transportState: String { reportedTransportState ?? (playing ? "PLAYING" : "PAUSED_PLAYBACK") }
    var displayVolume: Int {
        baseline.map { $0 > 0 ? Int((Double(rawVolume) / Double($0) * 100).rounded()) : rawVolume } ?? rawVolume
    }
}
enum HomeCommand {
    case fan(Bool)
    case fanMode(String)
    case toggle(Accessory)
    case brightness(Int)
    case kelvin(Int)
    case scene(String)
    case color(Int, String?)
    case party(PartySpeed)
    case mode(ClimateMode)
    case target(Int)
    case low(Int)
    case high(Int)
    case shiftRange(Int)
    case saveAlarm(Alarm)
    case deleteAlarm(Int)
    case enableAlarm(Int, Bool)
    case snoozeAlarm(Int, Int)
    case stopAlarm(Int, Int)
    case transport(String, SonosTransport)
    case seek(String, Double)
    case rawVolume(String, Int)
    case roomVolumes([String: Int])
    case volume(String, Int)
    case mute(String)
    case globalLock, groupLock, calibrate, clearCalibration
    case joinAll(String)
    case join(String, String)
    case leave(String)
}
/// Shared presentation status; reasons are authored by providers, never raw server text.
enum HomeModule: String, CaseIterable {
    case lights, climate, fan, wifi, sonos, weather, photos, walk, alarms, calendar, tesla
}
enum HomeModuleStatus: Equatable {
    case loading, live
    case unavailable(String)
    case unconfigured(String)
    var reason: String? {
        switch self {
        case .loading: "Loading…"
        case .live: nil
        case .unavailable(let reason), .unconfigured(let reason): reason
        }
    }
    init(_ availability: LiveAvailability) {
        switch availability {
        case .loading: self = .loading
        case .live: self = .live
        case .unavailable(let reason): self = .unavailable(reason)
        }
    }
}

struct SonosVolumeBalance {
    let levels: [String: Int]

    static func average(_ levels: [Int]) -> Int {
        guard !levels.isEmpty else { return 0 }
        return Int((Double(levels.reduce(0, +)) / Double(levels.count)).rounded())
    }

    func adjusted(to target: Int) -> [String: Int] {
        if target == 0 || target == 100 { return levels.mapValues { _ in target } }
        if target == Self.average(Array(levels.values)) { return levels }

        var remainingVolume = target * levels.count
        var remainingWeight = levels.values.reduce(0, +)
        var remainingRooms = levels.count
        var adjusted: [String: Int] = [:]
        // Reserve 100% for saturated rooms before scaling the quieter ones.
        // When every remaining room started silent, split the remaining volume evenly.
        for (id, weight) in levels.sorted(by: { $0.value > $1.value }) {
            let volume =
                remainingWeight > 0
                ? Double(weight * remainingVolume) / Double(remainingWeight)
                : Double(remainingVolume) / Double(remainingRooms)
            adjusted[id] = min(100, Int(volume.rounded()))
            if volume >= 100 {
                remainingVolume -= 100
                remainingWeight -= weight
                remainingRooms -= 1
            }
        }
        return adjusted
    }
}
