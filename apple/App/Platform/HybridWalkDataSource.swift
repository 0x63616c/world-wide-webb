import Foundation
import Observation

/// The existing walk views read HomeDataSource.now for durations and summaries.
/// Project only those views onto server time; Calendar and the home clock stay local.
/// This adapter owns no state and leaves the prototype's presentation untouched.
@MainActor @Observable final class HybridWalkDataSource: HomeDataSource, WalkHistoryEditing {
    private let store: LiveHomeDataSource
    init(store: LiveHomeDataSource) { self.store = store }

    func status(for module: HomeModule) -> HomeModuleStatus { store.status(for: module) }

    var now: Date { store.walkProvider.serverNow(at: store.now) }
    var walks: any WalkProvider { self }
    var activeWalk: DogWalk? { store.walkProvider.activeWalk }
    var history: [DogWalk] { store.walkProvider.history }
    var isMutating: Bool { store.walkProvider.isMutating }
    var historyFailureMessage: String? { store.walkProvider.historyFailureMessage }
    func update(id: String, startedAt: Date, endedAt: Date) async -> Bool {
        await store.walkProvider.update(id: id, startedAt: startedAt, endedAt: endedAt)
    }
    func delete(id: String) async -> Bool { await store.walkProvider.delete(id: id) }
    // LiveWalkProvider takes local dates and applies the server offset itself.
    func start(at date: Date) {
        guard store.hasLiveData(for: .walk) else { return }
        store.walkProvider.start(at: date.addingTimeInterval(-store.walkProvider.serverTimeOffset))
    }
    func stop(at date: Date) {
        guard store.hasLiveData(for: .walk) else { return }
        store.walkProvider.stop(at: date.addingTimeInterval(-store.walkProvider.serverTimeOffset))
    }

    var walkActivity: WalkLiveActivityManager { store.walkActivity }
    var lamps: LampState { store.lamps }
    var climate: ClimateState { store.climate }
    var wifi: WifiState { store.wifi }
    var weather: WeatherState { store.weather }
    var tesla: any TeslaProvider { store.tesla }
    var calendar: any CalendarProvider { store.calendar }
    var photos: any PhotosProvider { store.photos }
    var alarms: [Alarm] { store.alarms }
    var occurrence: AlarmOccurrence? { store.occurrence }
    var rooms: [SoundRoom] { store.rooms }
    var globalLock: Bool { store.globalLock }
    var groupLock: Bool { store.groupLock }
    var pending: Set<String> { store.pending }
    func send(_ command: HomeCommand) { store.send(command) }
    func upcomingAlarm(at date: Date) -> UpcomingAlarm? { store.upcomingAlarm(at: date) }
}
