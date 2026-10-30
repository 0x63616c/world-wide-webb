import Foundation
import Testing
@testable import PanelKit

@MainActor @Test func syncPollsImmediatelyThenOnMonotonicCadenceWithoutOverlap() async throws {
    let clock = ManualSyncClock()
    let sync = SyncCoordinator<Int>(clock: clock.clock)
    var calls = 0
    let refresh: @MainActor () async -> Void = {
        calls += 1
        let sent = clock.date
        do { try await clock.clock.sleep(.seconds(1)) } catch { return }
        guard !Task.isCancelled else { return }
        sync.accept(calls, sentAt: sent)
    }
    sync.setSceneActive(true, refresh: refresh)
    defer { sync.setSceneActive(false, refresh: refresh) }
    try await eventually { calls == 1 && clock.pendingSleeps == 1 }
    sync.setSceneActive(true, refresh: refresh) // No duplicate poll.
    clock.advance(.seconds(1))
    try await eventually { sync.lastKnown == 1 && clock.pendingSleeps == 1 }
    clock.jumpWallTime(.seconds(3600)) // Device clock adjustment cannot change the deadline.
    clock.advance(.seconds(2))
    await drain()
    #expect(calls == 1)
    clock.advance(.seconds(1))
    try await eventually { calls == 2 && clock.pendingSleeps == 1 }
    #expect(sync.lastKnown == 1)
    clock.advance(.seconds(1))
    try await eventually { sync.lastKnown == 2 }
}

@MainActor @Test func syncBacksOffCapsRetainsLastKnownAndResetsAfterRecovery() async throws {
    let clock = ManualSyncClock()
    let sync = SyncCoordinator<String>(interval: .seconds(4), maximumBackoff: .seconds(16), clock: clock.clock)
    sync.accept("confirmed", sentAt: clock.date)
    let lastSyncedAt = sync.lastSyncedAt
    var calls = 0
    var offline = true
    let refresh: @MainActor () async -> Void = {
        calls += 1
        if offline { sync.recordFailure() }
        else { sync.accept("recovered", sentAt: clock.date) }
    }
    sync.setSceneActive(true, refresh: refresh)
    defer { sync.setSceneActive(false, refresh: refresh) }
    try await eventually { calls == 1 && clock.pendingSleeps == 1 }
    for delay in [8, 16, 16] {
        let count = calls
        clock.advance(.seconds(delay - 1))
        await drain()
        #expect(calls == count)
        clock.advance(.seconds(1))
        try await eventually { calls == count + 1 && clock.pendingSleeps == 1 }
    }
    #expect(sync.lastKnown == "confirmed")
    #expect(sync.lastSyncedAt == lastSyncedAt)
    #expect(sync.consecutiveFailures == 4)
    offline = false
    clock.advance(.seconds(16))
    try await eventually { sync.lastKnown == "recovered" && clock.pendingSleeps == 1 }
    #expect(sync.consecutiveFailures == 0)
    let count = calls
    clock.advance(.seconds(4))
    try await eventually { calls == count + 1 }
}

@MainActor @Test func syncForegroundBypassesBackoffAndBackgroundCancelsSleep() async throws {
    let clock = ManualSyncClock()
    let sync = SyncCoordinator<Int>(clock: clock.clock)
    var calls = 0
    let refresh: @MainActor () async -> Void = { calls += 1; sync.recordFailure() }
    sync.setSceneActive(true, refresh: refresh)
    defer { sync.setSceneActive(false, refresh: refresh) }
    try await eventually { calls == 1 && clock.pendingSleeps == 1 }
    sync.setSceneActive(false, refresh: refresh)
    try await eventually { clock.pendingSleeps == 0 }
    clock.advance(.seconds(600))
    await drain()
    #expect(calls == 1)
    sync.setSceneActive(true, refresh: refresh)
    try await eventually { calls == 2 && clock.pendingSleeps == 1 }
}

@MainActor @Test func syncSkewUsesRequestMidpointAndPreservesOffsetWithoutServerTime() {
    let clock = ManualSyncClock()
    let sync = SyncCoordinator<Int>(clock: clock.clock)
    let sent = clock.date
    clock.advance(.seconds(2))
    sync.accept(42, serverTime: sent.addingTimeInterval(120), sentAt: sent)
    #expect(sync.serverTimeOffset == 119)
    #expect(sync.serverNow(at: clock.date) == sent.addingTimeInterval(121))
    sync.accept(43, sentAt: clock.date)
    #expect(sync.serverTimeOffset == 119)
    sync.recordFailure()
    #expect(sync.lastKnown == 43)
    #expect(sync.serverTimeOffset == 119)
}

@MainActor @Test func syncSlowFeatureDoesNotBlockAnotherAndNeverBurstsToCatchUp() async throws {
    let clock = ManualSyncClock()
    let slow = SyncCoordinator<Int>(clock: clock.clock)
    let fast = SyncCoordinator<Int>(clock: clock.clock)
    var slowCalls = 0
    var fastCalls = 0
    slow.setSceneActive(true) {
        slowCalls += 1
        do { try await clock.clock.sleep(.seconds(10)) } catch { return }
        slow.accept(slowCalls, sentAt: clock.date)
    }
    fast.setSceneActive(true) { fastCalls += 1; fast.accept(fastCalls, sentAt: clock.date) }
    defer { slow.setSceneActive(false) {}; fast.setSceneActive(false) {} }
    try await eventually { slowCalls == 1 && fastCalls == 1 && clock.pendingSleeps == 2 }
    clock.advance(.seconds(4))
    try await eventually { fastCalls == 2 && clock.pendingSleeps == 2 }
    #expect(slowCalls == 1)
    clock.advance(.seconds(6))
    try await eventually { slow.lastKnown == 1 && fastCalls == 3 && clock.pendingSleeps == 2 }
    #expect(slowCalls == 1)
    clock.advance(.seconds(4))
    try await eventually { slowCalls == 2 && fastCalls == 4 }
}

@MainActor @Test func syncDeallocationCancelsPendingSleep() async throws {
    let clock = ManualSyncClock()
    var sync: SyncCoordinator<Int>? = SyncCoordinator(clock: clock.clock)
    weak var weakSync = sync
    sync?.setSceneActive(true) {}
    try await eventually { clock.pendingSleeps == 1 }
    sync = nil
    #expect(weakSync == nil)
    try await eventually { clock.pendingSleeps == 0 }
}

@MainActor private func drain() async { for _ in 0..<30 { await Task.yield() } }
@MainActor private func eventually(_ condition: () -> Bool) async throws {
    for _ in 0..<10_000 { if condition() { return }; await Task.yield() }
    struct Timeout: Error {}
    throw Timeout()
}

/// No timers or wall-clock sleeps. Continuations resume only on advance/cancellation.
@MainActor private final class ManualSyncClock {
    var date = Date(timeIntervalSince1970: 1_800_000_000)
    private var elapsed: Duration = .zero
    private var sleepers: [UUID: (Duration, CheckedContinuation<Void, any Error>)] = [:]
    var pendingSleeps: Int { sleepers.count }
    var clock: SyncClock {
        SyncClock(now: { self.date }, elapsed: { self.elapsed }, sleep: { delay in
            let id = UUID()
            try await withTaskCancellationHandler {
                try Task.checkCancellation()
                try await withCheckedThrowingContinuation { self.sleepers[id] = (self.elapsed + delay, $0) }
            } onCancel: {
                Task { @MainActor in self.sleepers.removeValue(forKey: id)?.1.resume(throwing: CancellationError()) }
            }
        })
    }
    func advance(_ duration: Duration) {
        elapsed += duration
        jumpWallTime(duration)
        let ready = sleepers.filter { $0.value.0 <= elapsed }
        for id in ready.keys { sleepers.removeValue(forKey: id)?.1.resume() }
    }
    func jumpWallTime(_ duration: Duration) {
        date += Double(duration.components.seconds) + Double(duration.components.attoseconds) / 1e18
    }
}
