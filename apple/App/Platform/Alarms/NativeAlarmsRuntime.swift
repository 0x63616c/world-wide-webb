import Foundation
import Observation
import PanelKit

@MainActor @Observable final class NativeAlarmsRuntime {
    private(set) var ownsRinging = false
    private(set) var message: String?
    private let scheduler: any NativeAlarmScheduling
    private var reconciling = false
    private var synchronizedNext: AlarmNext?
    private var didSyncNext = false
    init(scheduler: any NativeAlarmScheduling = NativeAlarmScheduler.shared) { self.scheduler = scheduler }

    func reconcile(
        snapshot: AlarmsSnapshot?, available: Bool, configured: Bool,
        syncWidget: (AlarmNext?) async throws -> Void
    ) async {
        guard !reconciling else { return }
        reconciling = true
        defer { reconciling = false }
        guard available, configured, let snapshot else {
            await release()
            return
        }
        do {
            guard try await scheduler.authorize() else { throw NativeAlarmFailure.unavailable }
            try await scheduler.sync(snapshot)
            ownsRinging = true
            if !didSyncNext || synchronizedNext != snapshot.next {
                try await syncWidget(snapshot.next)
                synchronizedNext = snapshot.next
                didSyncNext = true
            }
            message = nil
        } catch {
            message = "Native alarms are unavailable."
            await release()
        }
    }

    func release() async {
        do {
            try scheduler.cancel()
            ownsRinging = false
            didSyncNext = false
        } catch {
            message = "Could not release the native alarm. Reconnecting…"
        }
    }
}

#if DEBUG
    @MainActor final class FixtureAlarmScheduler: NativeAlarmScheduling {
        func authorize() async throws -> Bool { true }
        func sync(_ snapshot: AlarmsSnapshot) async throws {}
        func cancel() throws {}
    }
#endif
