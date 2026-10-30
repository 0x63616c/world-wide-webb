import Foundation
import Observation

/// The existing walk views read HomeDataSource.now for durations and summaries.
/// Project only those views onto server time; Calendar and the home clock stay local.
/// This adapter owns no state and leaves the prototype's presentation untouched.
@MainActor @Observable final class HybridWalkDataSource: HomeDataSource, WalkProvider {
    private let store: LiveHomeDataSource
    init(store: LiveHomeDataSource) { self.store = store }

    var now: Date { store.walkProvider.serverNow(at: store.now) }
    var walks: any WalkProvider { self }
    var activeWalk: DogWalk? { store.walkProvider.activeWalk }
    var history: [DogWalk] { store.walkProvider.history }
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
    var cameras: any CamerasProvider { store.cameras }
    var media: any MediaProvider { store.media }
    var alarms: [Alarm] { store.alarms }
    var occurrence: AlarmOccurrence? { store.occurrence }
    var rooms: [SoundRoom] { store.rooms }
    var globalLock: Bool { store.globalLock }
    var groupLock: Bool { store.groupLock }
    var pending: Set<String> { store.pending }
    func send(_ command: HomeCommand) { store.send(command) }
    func upcomingAlarm(at date: Date) -> UpcomingAlarm? { store.upcomingAlarm(at: date) }
}
