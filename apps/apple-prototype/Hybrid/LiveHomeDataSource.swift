import Foundation
import Observation
import PanelKit

/// Composition belongs to Panel, leaving the prototype app and its previews alone.
/// Computed projections preserve Observation through the live provider objects.
@MainActor @Observable final class LiveHomeDataSource: HomeDataSource {
    let remindersProvider: LiveRemindersProvider
    let lightsProvider: LiveLightsProvider
    let climateProvider: LiveClimateProvider
    let fanProvider: LiveFanProvider
    let wifiProvider: LiveWifiProvider
    let weatherProvider: LiveWeatherProvider
    let sonosProvider: LiveSonosProvider
    let calendarProvider: LiveCalendarProvider
    private let unavailable = UnavailableHomeProviders()
    let walkActivity = WalkLiveActivityManager()
    let alarms: [Alarm] = []
    let occurrence: AlarmOccurrence? = nil
    @ObservationIgnored private let clock: () -> Date
    var now: Date { calendarProvider.availability == .live ? calendarProvider.referenceDate : clock() }
    var tesla: any TeslaProvider { unavailable }
    var calendar: any CalendarProvider { calendarProvider }
    var photos: any PhotosProvider { unavailable }
    var cameras: any CamerasProvider { unavailable }
    var media: any MediaProvider { unavailable }
    var walks: any WalkProvider { unavailable }
    @ObservationIgnored private var fanMutation: Task<Void, Never>?

    init(configuration: PanelKit.PanelConfiguration?, transport: (any PanelTransport)? = nil,
         remindersAPI: any RemindersServing = RemindersAPI(),
         calendarAPI: CalendarAPI = CalendarAPI(), now: @escaping () -> Date = Date.init,
         calendar: @escaping () -> Calendar = { .autoupdatingCurrent }) {
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
        lightsProvider = LiveLightsProvider(api: LightsAPI(client: client), initialLamps: .unavailable)
        climateProvider = LiveClimateProvider(api: ClimateAPI(client: client))
        fanProvider = LiveFanProvider(api: FanAPI(client: client))
        wifiProvider = LiveWifiProvider(api: WifiAPI(client: client))
        weatherProvider = LiveWeatherProvider(api: WeatherAPI(client: client))
        sonosProvider = LiveSonosProvider(api: SonosAPI(configuration: configuration, transport: transport))
    }

    func hasLiveData(for module: PanelModule) -> Bool {
        switch module {
        case .reminders: remindersProvider.availability == .live
        case .all: false
        case .lights: lightsProvider.availability == .live
        case .climate: climateProvider.availability == .live && climateProvider.climate != nil
        case .fan: fanProvider.availability == .live && fanProvider.fanOn != nil
        case .wifi: wifiProvider.availability == .live && !(wifiProvider.wifi.ssid ?? "").isEmpty
        case .weather: weatherProvider.availability == .live && weatherProvider.snapshot != nil
        case .sonos: sonosProvider.availability == .live && !rooms.isEmpty
        case .calendar: calendarProvider.availability == .live && !calendarProvider.events.isEmpty
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
        var result: Set<String> = []
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
        default: break // Alarms, seek and fixture-library playback have no live implementation.
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
        case .reminders: await remindersProvider.refresh()
        case .all: break
        case .lights: await lightsProvider.refresh()
        case .climate: await climateProvider.refresh()
        case .fan: await fanProvider.refresh()
        case .wifi: await wifiProvider.refresh()
        case .weather: await weatherProvider.refresh()
        case .sonos: await sonosProvider.refresh()
        case .calendar: await calendarProvider.refresh()
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
        while !Task.isCancelled {
            await refresh(module)
            do { try await Task.sleep(for: module == .weather ? .seconds(600) : .seconds(10)) }
            catch { return }
        }
    }

    func stop() {
        lightsProvider.stop()
        climateProvider.stop()
        weatherProvider.stop()
        sonosProvider.stop()
        calendarProvider.stop()
        fanMutation?.cancel()
        fanMutation = nil
    }
}
