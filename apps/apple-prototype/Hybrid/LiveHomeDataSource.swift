import Foundation
import Observation
import PanelKit
import CryptoKit
import OSLog

/// Composition belongs to Panel, leaving the prototype app and its previews alone.
/// Computed projections preserve Observation through the live provider objects.
@MainActor @Observable final class LiveHomeDataSource: HomeDataSource {
    private(set) var errorMessage: String?
    private(set) var errorRevision = 0
    private static let commandLog = Logger(subsystem: "co.worldwidewebb.panel", category: "commands")

    let mediaProvider: LiveMediaProvider
    let camerasProvider: LiveCamerasProvider
    let remindersProvider: LiveRemindersProvider
    let lightsProvider: LiveLightsProvider
    let climateProvider: LiveClimateProvider
    let fanProvider: LiveFanProvider
    let wifiProvider: LiveWifiProvider
    let weatherProvider: LiveWeatherProvider
    let alarmsProvider: LiveAlarmsProvider
    let sonosArtwork: SonosArtworkAPI
    let sonosProvider: LiveSonosProvider
    let teslaProvider: LiveTeslaProvider
    let photosProvider: LivePhotosProvider
    let calendarProvider: LiveCalendarProvider
    let walkProvider: LiveWalkProvider
    let diagnosticsClient: PanelAPIClient
    let diagnosticsBackendURL: String
    private var commandName = "command"
    private var commandPayload: Data?
    private let unavailable = UnavailableHomeProviders()
    let walkActivity = WalkLiveActivityManager()
    var alarms: [Alarm] { alarmsProvider.alarms }
    let occurrence: AlarmOccurrence? = nil
    func upcomingAlarm(at date: Date) -> UpcomingAlarm? { alarmsProvider.upcoming(at: date) }
    @ObservationIgnored private let clock: () -> Date
    var now: Date {
        // Calendar refreshes invalidate time-based labels, without freezing the
        // shared Home clock at the last event read for other modules.
        _ = calendarProvider.referenceDate
        return clock()
    }
    var tesla: any TeslaProvider { teslaProvider }
    var calendar: any CalendarProvider { calendarProvider }
    var photos: any PhotosProvider { photosProvider }
    var cameras: any CamerasProvider { camerasProvider }
    var media: any MediaProvider { mediaProvider }
    var walks: any WalkProvider { walkProvider }
    @ObservationIgnored private var walkRunID: UUID?

    init(configuration: PanelKit.PanelConfiguration?, transport: (any PanelTransport)? = nil,
         remindersAPI: any RemindersServing = RemindersAPI(), mediaAPI: any MediaServing = MediaAPI(),
         calendarAPI: CalendarAPI = CalendarAPI(), sonosLockDefaults: UserDefaults? = nil, now: @escaping () -> Date = Date.init,
         calendar: @escaping () -> Calendar = { .autoupdatingCurrent }, walkClock: SyncClock? = nil) {
        diagnosticsClient = PanelAPIClient(configuration: configuration)
        // An origin is sufficient to identify deployment; omit path/query/user info.
        if let url = configuration?.baseURL, let host = url.host {
            diagnosticsBackendURL = "\(url.scheme ?? "https")://\(host)" + (url.port.map { ":\($0)" } ?? "")
        } else { diagnosticsBackendURL = "unconfigured" }
        mediaProvider = LiveMediaProvider(api: mediaAPI, configuration: configuration)
        camerasProvider = LiveCamerasProvider(api: CamerasAPI(configuration: configuration, transport: transport))
        clock = now
        calendarProvider = LiveCalendarProvider(api: calendarAPI, now: now, calendar: calendar)
        remindersProvider = LiveRemindersProvider(api: remindersAPI)
        // Guest credentials and Access sessions must remain memory-only.
        let session = URLSessionConfiguration.ephemeral
        session.urlCache = nil
        session.httpCookieStorage = nil
        session.urlCredentialStorage = nil
        let photoAPI = transport.map {
            PhotosAPI(client: PanelAPIClient(configuration: configuration, transport: $0))
        } ?? PhotosAPI(configuration: configuration)
        sonosArtwork = SonosArtworkAPI(configuration: configuration, transport: transport)
        let transport = transport ?? URLSession(configuration: session)
        let client = PanelAPIClient(configuration: configuration, transport: transport)
        walkProvider = LiveWalkProvider(api: WalksAPI(client: client), device: .iPad, now: now, clock: walkClock)
        teslaProvider = LiveTeslaProvider(api: TeslaAPI(client: client))
        let namespace = SHA256.hash(data: Data((configuration?.baseURL.absoluteString ?? "unconfigured").utf8))
            .map { String(format: "%02x", $0) }.joined()
        let cacheRoot = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("PanelPhotos").appendingPathComponent(namespace)
        photosProvider = LivePhotosProvider(api: photoAPI, cache: PhotoCache(directory: cacheRoot))
        alarmsProvider = LiveAlarmsProvider(api: AlarmsAPI(client: client))
        lightsProvider = LiveLightsProvider(api: LightsAPI(client: client), initialLamps: .unavailable)
        climateProvider = LiveClimateProvider(api: ClimateAPI(client: client))
        fanProvider = LiveFanProvider(api: FanAPI(client: client))
        wifiProvider = LiveWifiProvider(api: WifiAPI(client: client))
        weatherProvider = LiveWeatherProvider(api: WeatherAPI(client: client))
        sonosProvider = LiveSonosProvider(api: SonosAPI(configuration: configuration, transport: transport), lockDefaults: sonosLockDefaults)
    }

    func status(for module: HomeModule) -> HomeModuleStatus {
        switch module {
        case .tesla: return teslaProvider.moduleStatus
        case .lights: return HomeModuleStatus(lightsProvider.availability)
        case .climate: return HomeModuleStatus(climateProvider.availability)
        case .fan: return HomeModuleStatus(fanProvider.availability)
        case .wifi:
            if wifiProvider.availability == .live && (wifi.ssid ?? "").isEmpty {
                return .unconfigured("Guest Wi-Fi isn't set up on the server")
            }
            return HomeModuleStatus(wifiProvider.availability)
        case .sonos:
            if sonosProvider.availability == .live && rooms.isEmpty {
                return .unavailable("No Sonos rooms available")
            }
            return HomeModuleStatus(sonosProvider.availability)
        case .weather: return HomeModuleStatus(weatherProvider.availability)
        case .photos:
            if photosProvider.availability == .live && photosProvider.frames.isEmpty {
                return .unavailable("No photos available")
            }
            return HomeModuleStatus(photosProvider.availability)
        case .walk: return HomeModuleStatus(walkProvider.availability)
        case .reminders: return HomeModuleStatus(remindersProvider.availability)
        case .alarms: return HomeModuleStatus(alarmsProvider.availability)
        case .calendar: return HomeModuleStatus(calendarProvider.availability)
        case .media: return HomeModuleStatus(mediaProvider.availability)
        case .cameras: return HomeModuleStatus(camerasProvider.availability)
        }
    }

    func hasLiveData(for module: PanelModule) -> Bool {
        switch module {
        case .media: mediaProvider.availability == .live && !mediaProvider.items.isEmpty
        case .cameras: camerasProvider.availability == .live && !camerasProvider.feeds.isEmpty
        case .alarms: alarmsProvider.availability == .live && alarmsProvider.snapshot != nil
        case .reminders: remindersProvider.availability == .live
        case .all: false
        case .tesla: teslaProvider.hasLiveData
        case .photos: photosProvider.availability == .live && !photosProvider.frames.isEmpty
        case .lights: lightsProvider.availability == .live
        case .climate: climateProvider.availability == .live && climateProvider.climate != nil
        case .fan: fanProvider.availability == .live && fanProvider.fanOn != nil
        case .wifi: wifiProvider.availability == .live && !(wifiProvider.wifi.ssid ?? "").isEmpty
        case .weather: weatherProvider.availability == .live && weatherProvider.snapshot != nil
        case .sonos: sonosProvider.availability == .live && !rooms.isEmpty
        case .calendar: calendarProvider.availability == .live && !calendarProvider.events.isEmpty
        case .walk: walkProvider.availability == .live
        }
    }

    var lamps: LampState { hasLiveData(for: .lights) ? lightsProvider.lamps : .unavailable }

    var climate: ClimateState {
        var value = ClimateState.unavailable
        if hasLiveData(for: .climate), let reported = climateProvider.climate {
            value = reported
            value.reportedAction = climateProvider.reportedAction?.rawValue ?? "Unavailable"
            // An off response may have no remembered setpoints. Do not leak the
            // provider's prototype defaults into the composed source.
            if case .off(let target, let low, let high) = climateProvider.serverState?.setpoints {
                value.target = target.map { Int($0.rounded()) } ?? 0
                value.low = low.map { Int($0.rounded()) } ?? 0
                value.high = high.map { Int($0.rounded()) } ?? 0
            }
        }
        value.fanModes = fanProvider.fanModes
        value.selectedFanMode = fanProvider.selectedMode
        value.fanOn = hasLiveData(for: .fan) ? fanProvider.fanOn ?? false : false
        value.reportedFanLabel = hasLiveData(for: .fan) ? fanProvider.fanLabel ?? "Unavailable" : "Unavailable"
        return value
    }

    var wifi: WifiState { hasLiveData(for: .wifi) ? wifiProvider.wifi : .unconfigured }

    var weather: WeatherState {
        guard hasLiveData(for: .weather), let snapshot = weatherProvider.snapshot else { return .unavailable }
        return WeatherState(city: snapshot.city, temperature: snapshot.temperature, condition: snapshot.condition,
                            symbol: snapshot.symbol,
                            high: snapshot.high, low: snapshot.low, feels: snapshot.feels, humidity: snapshot.humidity,
                            wind: snapshot.wind, solarLabel: snapshot.solarLabel, solarValue: snapshot.solarValue,
                            hours: snapshot.hours)
    }

    var rooms: [SoundRoom] {
        guard sonosProvider.availability == .live else { return [] }
        return sonosProvider.rooms.filter { sonosProvider.roomDetails[$0.id]?.availability == .available }
    }

    var globalLock: Bool { hasLiveData(for: .sonos) && sonosProvider.globalLock }
    var groupLock: Bool { hasLiveData(for: .sonos) && sonosProvider.groupLock }
    var pending: Set<String> {
        var result: Set<String> = alarmsProvider.pending ? ["alarms"] : []
        if hasLiveData(for: .lights) {
            for key in lightsProvider.pending {
                switch key {
                case "bedroomLamps": result.insert("bedroom")
                case "otherLamps": result.insert("livingRoom")
                case "fan": break // Fan is owned by its independent provider.
                default: result.insert(key)
                }
            }
        }
        if hasLiveData(for: .climate) { result.formUnion(climateProvider.pending) }
        if hasLiveData(for: .fan) { result.formUnion(fanProvider.pending) }
        if hasLiveData(for: .sonos) { result.formUnion(sonosProvider.pending) }
        return result
    }

    func send(_ command: HomeCommand) {
        errorMessage = nil
        commandName = String(String(describing: command).prefix(while: { $0 != "(" }))
        switch command {
        case .brightness(let value), .kelvin(let value), .target(let value), .low(let value), .high(let value), .shiftRange(let value):
            commandPayload = try? JSONEncoder().encode(["value": value])
        case .rawVolume(_, let value), .volume(_, let value):
            commandPayload = try? JSONEncoder().encode(["volume": value])
        case .fan(let on), .enableAlarm(_, let on):
            commandPayload = try? JSONEncoder().encode(["on": on])
        default:
            commandPayload = Data(#"{"value":"<redacted>"}"#.utf8)
        }
        switch command {
        case .saveAlarm, .deleteAlarm, .enableAlarm, .snoozeAlarm, .stopAlarm:
            guard requireLive(.alarms) else { return }
            alarmsProvider.send(command)
        case .toggle(.fan):
            guard requireLive(.fan), let on = fanProvider.fanOn else { return }
            fanProvider.setOn(!on)
        case .fan(let on):
            guard requireLive(.fan) else { return }
            fanProvider.setOn(on)
        case .fanMode(let mode):
            guard requireLive(.fan) else { return }
            guard fanProvider.fanModes.contains(mode) else {
                rejectCommand("This fan mode is unavailable."); return
            }
            fanProvider.setMode(mode)
        case .toggle, .brightness, .kelvin, .scene, .color, .party:
            guard requireLive(.lights) else { return }
            if !lightsProvider.send(command) { rejectCommand("This lighting action is unavailable.") }
        case .mode, .target, .low, .high, .shiftRange:
            guard requireLive(.climate) else { return }
            if !climateProvider.send(command) { rejectCommand("This climate action is unavailable.") }
        case .joinAll(let target):
            guard requireLive(.sonos) else { return }
            guard let id = roomID(target), sonosProvider.send(.joinAll(id)) else {
                rejectCommand("The selected speaker is unavailable."); return
            }
        case .join(let member, let target):
            guard requireLive(.sonos) else { return }
            guard let member = roomID(member), let target = roomID(target), sonosProvider.send(.join(member, target)) else {
                rejectCommand("The selected speakers are unavailable."); return
            }
        case .transport, .seek, .rawVolume, .volume, .mute, .globalLock, .groupLock, .calibrate, .clearCalibration, .leave:
            guard requireLive(.sonos) else { return }
            if !sonosProvider.send(command) { rejectCommand("This speaker action is unavailable.") }
        case .playMedia:
            // The prototype's fixture library has no live backend procedure.
            rejectCommand("This media item cannot be played on the live panel.")
        }
    }

    private func requireLive(_ module: PanelModule) -> Bool {
        guard hasLiveData(for: module) else {
            rejectCommand("\(module.title) is unavailable. Refresh and try again.", reason: "dropped: module not live")
            return false
        }
        return true
    }

    private func rejectCommand(_ message: String, reason: String = "dropped: action unavailable") {
        PanelCommandLog.shared.record(control: commandName, input: commandPayload, error: reason)
        errorMessage = message
        errorRevision += 1
        // Log only our fixed user-facing messages, never command payloads or credentials.
        Self.commandLog.error("Panel command rejected: \(message, privacy: .public)")
    }

    // Some prototype group shortcuts use display names. Resolve only unambiguous
    // names, preferring stable IDs, so duplicate labels can never target a random room.
    private func roomID(_ value: String) -> String? {
        if rooms.contains(where: { $0.id == value }) { return value }
        let matches = rooms.filter { $0.name == value }
        return matches.count == 1 ? matches[0].id : nil
    }

    func refresh(_ module: PanelModule) async {
        switch module {
        case .media: await mediaProvider.refresh()
        case .cameras: await camerasProvider.refresh()
        case .alarms: await alarmsProvider.refresh()
        case .reminders: await remindersProvider.refresh()
        case .all: break
        case .tesla: await teslaProvider.refresh()
        case .photos: await photosProvider.refresh()
        case .lights: await lightsProvider.refresh()
        case .climate: await climateProvider.refresh()
        case .fan: await fanProvider.refresh()
        case .wifi: await wifiProvider.refresh()
        case .weather: await weatherProvider.refresh()
        case .sonos: await sonosProvider.refresh()
        case .calendar: await calendarProvider.refresh()
        case .walk: await walkProvider.refresh()
        }
    }

    /// One task per opted-in provider; a slow/unavailable service cannot hold up
    /// other modules. The caller's structured task owns foreground/background life.
    func run(modules: Set<PanelModule>) async {
        await withTaskGroup(of: Void.self) { group in
            for module in modules where module != .all {
                group.addTask { await self.poll(module) }
            }
            await group.waitForAll()
        }
    }

    private func poll(_ module: PanelModule) async {
        if module == .walk {
            guard !Task.isCancelled else { return }
            // Dog Walk already owns its four-second cadence, backoff and stale-read
            // guards. Keep its coordinator alive only for this foreground task.
            let runID = UUID()
            walkRunID = runID
            walkProvider.setSceneActive(false)
            walkProvider.setSceneActive(true)
            defer {
                // A cancelled old scene task must not stop a newer foreground run.
                if walkRunID == runID {
                    walkRunID = nil
                    walkProvider.setSceneActive(false)
                }
            }
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(3600)) }
                catch { return }
            }
            return
        }
        while !Task.isCancelled {
            await refresh(module)
            do { try await Task.sleep(for: module == .weather ? .seconds(600) : module == .photos ? .seconds(60) : module == .alarms ? .seconds(1) : .seconds(10)) }
            catch { return }
        }
    }

    func stop() {
        walkRunID = nil
        walkProvider.setSceneActive(false)
        teslaProvider.stop()
        photosProvider.lock()
        mediaProvider.stop()
        camerasProvider.stop()
        alarmsProvider.stop()
        lightsProvider.stop()
        climateProvider.stop()
        weatherProvider.stop()
        sonosProvider.stop()
        calendarProvider.stop()
        wifiProvider.stop()
        fanProvider.stop()
    }
}
