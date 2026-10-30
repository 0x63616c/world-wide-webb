import Foundation
import Observation
import PanelKit

/// Serial handoff: web cleanup is acknowledged before AlarmKit starts; AlarmKit
/// is canceled before web resumes. Legacy web bundles fail closed to web mode.
@MainActor @Observable final class NativeAlarmsRuntime {
    private(set) var ownsRinging = false
    private(set) var message: String?
    private let scheduler: any NativeAlarmScheduling
    private var epoch = 0
    private var synchronizedNext: AlarmNext?
    private var didSyncNext = false
    init(scheduler: any NativeAlarmScheduling = NativeAlarmScheduler.shared) { self.scheduler = scheduler }

    func reconcile(snapshot: AlarmsSnapshot?, available: Bool, configured: Bool,
                   handoff: (Bool) async -> Bool, syncWidget: (AlarmNext?) async throws -> Void) async {
        let expected = epoch
        guard available, configured, let snapshot else {
            await release(handoff: handoff)
            return
        }
        do {
            guard try await scheduler.authorize() else { throw NativeAlarmFailure.unavailable }
            guard expected == epoch else { return }
            if !ownsRinging {
                guard await handoff(true), expected == epoch else {
                    message = "Waiting for a compatible web alarm runtime."
                    return
                }
                ownsRinging = true
            }
            try await scheduler.sync(snapshot)
            guard expected == epoch else { try scheduler.cancel(); return }
            if !didSyncNext || synchronizedNext != snapshot.next {
                try await syncWidget(snapshot.next)
                synchronizedNext = snapshot.next
                didSyncNext = true
            }
            message = nil
        } catch {
            message = "Native alarms are unavailable. Using the web alarms page."
            await release(handoff: handoff)
        }
    }

    func release(handoff: (Bool) async -> Bool) async {
        do {
            try scheduler.cancel()
            ownsRinging = false
            didSyncNext = false
            _ = await handoff(false)
        } catch {
            // Do not give the web permission to ring while a system alarm may
            // still exist. Retry cancellation on the next foreground poll.
            message = "Could not release the native alarm. Reconnecting…"
        }
    }

    /// Called before a new document can run the web ringer.
    func prepareNavigation() throws {
        epoch += 1
        try scheduler.cancel()
        ownsRinging = false
        didSyncNext = false
    }
}

#if DEBUG
@MainActor final class FixtureAlarmScheduler: NativeAlarmScheduling {
    func authorize() async throws -> Bool { true }
    func sync(_ snapshot: AlarmsSnapshot) async throws {}
    func cancel() throws {}
}
#endif
