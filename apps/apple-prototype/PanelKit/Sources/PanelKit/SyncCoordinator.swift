import Foundation
import Observation

/// Wall time is used only for server timestamps. Poll deadlines use monotonic time.
/// Inject all three operations together to test lifecycle and cadence without real sleeps.
@MainActor public struct SyncClock {
    public let now: () -> Date
    public let elapsed: () -> Duration
    public let sleep: (Duration) async throws -> Void

    public init(now: @escaping () -> Date, elapsed: @escaping () -> Duration,
                sleep: @escaping (Duration) async throws -> Void) {
        self.now = now; self.elapsed = elapsed; self.sleep = sleep
    }

    public static func continuous(now: @escaping () -> Date = Date.init) -> Self {
        let clock = ContinuousClock()
        let origin = clock.now
        return Self(now: now, elapsed: { origin.duration(to: clock.now) },
                    sleep: { try await clock.sleep(for: $0) })
    }
}

/// One coordinator per feature and authenticated server configuration. Providers own
/// decoding, mutation ordering and presentation; this owns cadence and confirmed state.
/// No disk persistence: credentials, guest Wi-Fi and user state never enter a shared cache.
@MainActor @Observable public final class SyncCoordinator<State: Sendable> {
    public private(set) var lastKnown: State?
    public private(set) var lastSyncedAt: Date?
    public private(set) var serverTimeOffset: TimeInterval = 0
    public private(set) var consecutiveFailures = 0
    public private(set) var isSceneActive = false

    @ObservationIgnored public let clock: SyncClock
    @ObservationIgnored private let interval: Duration
    @ObservationIgnored private let maximumBackoff: Duration
    @ObservationIgnored private var pollingTask: Task<Void, Never>?
    @ObservationIgnored private var generation = 0

    public init(interval: Duration = .seconds(4), maximumBackoff: Duration = .seconds(60),
                clock: SyncClock = .continuous()) {
        precondition(interval > .zero && maximumBackoff >= interval)
        self.interval = interval; self.maximumBackoff = maximumBackoff; self.clock = clock
    }

    deinit { pollingTask?.cancel() }

    public func serverNow(at localDate: Date) -> Date {
        localDate.addingTimeInterval(serverTimeOffset)
    }

    /// Call only after the provider's request/revision guards accept a server response.
    /// Optimistic writes must never enter lastKnown. Endpoints without serverTime retain
    /// the previous offset (initially zero), rather than guessing from a device timestamp.
    public func accept(_ state: State, serverTime: Date? = nil, sentAt: Date) {
        let receivedAt = clock.now()
        if let serverTime {
            let midpoint = sentAt.addingTimeInterval(receivedAt.timeIntervalSince(sentAt) / 2)
            serverTimeOffset = serverTime.timeIntervalSince(midpoint)
        }
        lastKnown = state
        lastSyncedAt = receivedAt
        consecutiveFailures = 0
    }

    /// An unavailable read changes freshness, never the last confirmed value or its age.
    public func recordFailure() {
        consecutiveFailures = min(consecutiveFailures + 1, 30)
    }

    /// Foreground refreshes immediately, including during offline backoff. Duplicate
    /// scene notifications are idempotent. Background cancels reads, not mutations.
    /// The callback must reject cancelled/stale responses and capture its owner weakly.
    public func setSceneActive(_ active: Bool, refresh: @escaping @MainActor () async -> Void) {
        guard active != isSceneActive else { return }
        isSceneActive = active
        generation += 1
        pollingTask?.cancel()
        pollingTask = nil
        guard active else { return }
        let version = generation
        let clock = clock
        pollingTask = Task { [weak self] in
            while !Task.isCancelled {
                let started = clock.elapsed()
                await refresh()
                guard !Task.isCancelled, let delay = self?.delay(after: started, generation: version) else { return }
                do { try await clock.sleep(delay) } catch { return }
            }
        }
    }

    private func delay(after started: Duration, generation: Int) -> Duration? {
        guard isSceneActive, self.generation == generation else { return nil }
        if consecutiveFailures > 0 {
            // Backoff starts at twice the normal interval, measured after failure.
            var delay = interval
            for _ in 0..<consecutiveFailures { delay = min(maximumBackoff, delay * 2) }
            return delay
        }
        // Start-to-start cadence prevents request time accumulating on every poll.
        // A slow endpoint gets a full interval of rest; never burst to catch up.
        let remaining = interval - (clock.elapsed() - started)
        return remaining > .zero ? remaining : interval
    }
}
