import Foundation
import Observation
import PanelKit

/// Composition belongs to Panel, leaving the prototype app and its previews alone.
/// Computed projections preserve Observation through the live provider objects.
@MainActor @Observable final class LiveHomeDataSource: HomeDataSource {
    let mediaProvider: LiveMediaProvider
    let remindersProvider: LiveRemindersProvider
    let lightsProvider: LiveLightsProvider
    let climateProvider: LiveClimateProvider
    let fanProvider: LiveFanProvider
    let wifiProvider: LiveWifiProvider
    let weatherProvider: LiveWeatherProvider
    let alarmsProvider: LiveAlarmsProvider
    let sonosProvider: LiveSonosProvider
    let calendarProvider: LiveCalendarProvider
    let walkProvider: LiveWalkProvider
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
    var tesla: any TeslaProvider { unavailable }
    var calendar: any CalendarProvider { calendarProvider }
    var photos: any PhotosProvider { unavailable }
    var cameras: any CamerasProvider { unavailable }
    var media: any MediaProvider { mediaProvider }
    var walks: any WalkProvider { walkProvider }
    @ObservationIgnored private var fanMutation: Task<Void, Never>?

    init(configuration: PanelKit.PanelConfiguration?, transport: (any PanelTransport)? = nil,
         remindersAPI: any RemindersServing = RemindersAPI(), mediaAPI: any MediaServing = MediaAPI(),
         calendarAPI: CalendarAPI = CalendarAPI(), now: @escaping () -> Date = Date.init,
         calendar: @escaping () -> Calendar = { .autoupdatingCurrent }, walkClock: SyncClock? = nil) {
        mediaProvider = LiveMediaProvider(api: mediaAPI, configuration: configuration)
        clock = now
        calendarProvider = LiveCalendarProvider(api: calendarAPI, now: now, calendar: calendar)
        remindersProvider = LiveRemindersProvider(api: remindersAPI)
        // Guest credentials and Access sessions must remain memory-only.
        let session = URLSessionConfiguration.ephemeral
        session.urlCache = nil
        session.httpCookieStorage = nil
        session.urlCredentialStorage = nil
        let transport = transport ?? URLSession(configuration: session)
        let client = PanelAPIClient(configuration: configuration, transport: transport)
        walkProvider = LiveWalkProvider(api: WalksAPI(client: client), device: .iPad, now: now, clock: walkClock)
        alarmsProvider = LiveAlarmsProvider(api: AlarmsAPI(client: client))
        lightsProvider = LiveLightsProvider(api: LightsAPI(client: client), initialLamps: .unavailable)
        climateProvider = LiveClimateProvider(api: ClimateAPI(client: client))
        fanProvider = LiveFanProvider(api: FanAPI(client: client))
        wifiProvider = LiveWifiProvider(api: WifiAPI(client: client))
        weatherProvider = LiveWeatherProvider(api: WeatherAPI(client: client))
        sonosProvider = LiveSonosProvider(api: SonosAPI(configuration: configuration, transport: transport))
    }

    func hasLiveData(for module: PanelModule) -> Bool {
        switch module {
        case .media: mediaProvider.availability == .live && !mediaProvider.items.isEmpty
        case .alarms: alarmsProvider.availability == .live && alarmsProvider.snapshot != nil
        case .reminders: remindersProvider.availability == .live
        case .all: false
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
        return sonosProvider.rooms.compactMap { projection in
            guard let room = sonosProvider.roomDetails[projection.id], room.availability == .available else { return nil }
            return SoundRoom(metadata: .init(id: room.uuid, title: room.trackTitle, artist: room.trackArtist,
                                             coordinatorName: sonosProvider.roomDetails[room.coordinatorUuid]?.name),
                             name: room.name, rawVolume: projection.rawVolume, baseline: projection.baseline,
                             muted: projection.muted, coordinator: room.coordinatorUuid, playing: projection.playing,
                             positionSeconds: 0, durationSeconds: 0, positionUpdatedAt: .distantPast,
                             sourceKind: SoundSource(rawValue: room.sourceKind.rawValue) ?? .other,
                             sourceLabel: room.sourceLabel, albumArtUri: room.albumArtUri)
        }
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
        switch command {
        case .saveAlarm, .deleteAlarm, .enableAlarm, .snoozeAlarm, .stopAlarm:
            if hasLiveData(for: .alarms) { alarmsProvider.send(command) }
        case .toggle(.fan):
            guard hasLiveData(for: .fan), fanMutation == nil else { return }
            fanMutation = Task { [weak self] in
                await self?.fanProvider.toggle()
                self?.fanMutation = nil
            }
        case .toggle, .brightness, .kelvin, .scene, .color, .party:
            if hasLiveData(for: .lights) { lightsProvider.send(command) }
        case .mode, .target, .low, .high, .shiftRange:
            if hasLiveData(for: .climate) { climateProvider.send(command) }
        case .joinAll(let target):
            if let id = roomID(target), hasLiveData(for: .sonos) { sonosProvider.send(.joinAll(id)) }
        case .join(let member, let target):
            if let member = roomID(member), let target = roomID(target), hasLiveData(for: .sonos) {
                sonosProvider.send(.join(member, target))
            }
        case .transport, .rawVolume, .volume, .mute, .globalLock, .groupLock, .calibrate, .clearCalibration, .leave:
            if hasLiveData(for: .sonos) { sonosProvider.send(command) }
        default: break // Seeking and fixture-library playback have no live implementation.
        }
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
        case .alarms: await alarmsProvider.refresh()
        case .reminders: await remindersProvider.refresh()
        case .all: break
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
            walkProvider.setSceneActive(true)
            defer { walkProvider.setSceneActive(false) }
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(3600)) }
                catch { return }
            }
            return
        }
        while !Task.isCancelled {
            await refresh(module)
            do { try await Task.sleep(for: module == .weather ? .seconds(600) : module == .alarms ? .seconds(1) : .seconds(10)) }
            catch { return }
        }
    }

    func stop() {
        walkProvider.setSceneActive(false)
        mediaProvider.stop()
        alarmsProvider.stop()
        lightsProvider.stop()
        climateProvider.stop()
        weatherProvider.stop()
        sonosProvider.stop()
        calendarProvider.stop()
        fanMutation?.cancel()
        fanMutation = nil
    }
}
