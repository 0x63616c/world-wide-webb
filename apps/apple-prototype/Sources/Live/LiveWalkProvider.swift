import Foundation
import Observation
import PanelKit

/// Opt-in live adapter. Retain once per app, then forward scene activity to setSceneActive.
/// DogWalk dates stay in server time; views pass serverNow(at:) to duration/summary helpers.
@MainActor @Observable final class LiveWalkProvider: WalkProvider {
    private(set) var activeWalk: DogWalk?
    private(set) var history: [DogWalk] = []
    private(set) var availability: LiveAvailability = .loading
    private(set) var historyAvailability: LiveAvailability = .loading
    private(set) var isMutating = false
    private(set) var hasLoadedState = false
    private(set) var serverTimeOffset: TimeInterval = 0
    private(set) var lastSyncedAt: Date?
    private(set) var hasAttemptedMutation = false

    @ObservationIgnored private let api: WalksAPI
    @ObservationIgnored private let device: WalkDevice
    @ObservationIgnored private let now: () -> Date
    @ObservationIgnored private let makeID: () -> UUID
    @ObservationIgnored private let pollInterval: Duration
    @ObservationIgnored private var confirmedWalk: DogWalk?
    @ObservationIgnored private var confirmedHistory: [DogWalk] = []
    @ObservationIgnored private var stateUpdatedAt: Date?
    @ObservationIgnored private var historyDirty = true
    @ObservationIgnored private var retryStartID: UUID?
    @ObservationIgnored private var revision = 0
    @ObservationIgnored private var refreshID: UUID?
    @ObservationIgnored private var historyRequestID: UUID?
    @ObservationIgnored private var pollingTask: Task<Void, Never>?
    @ObservationIgnored private var mutationTask: Task<Void, Never>?

    init(api: WalksAPI, device: WalkDevice, now: @escaping () -> Date = Date.init,
         makeID: @escaping () -> UUID = UUID.init, pollInterval: Duration = .seconds(5)) {
        precondition(pollInterval > .zero)
        self.api = api; self.device = device; self.now = now
        self.makeID = makeID; self.pollInterval = pollInterval
    }

    deinit { pollingTask?.cancel(); mutationTask?.cancel() }

    func serverNow(at localDate: Date) -> Date { localDate.addingTimeInterval(serverTimeOffset) }

    /// An immediate state/history refresh on foreground, then state polling every five seconds.
    /// Backgrounding stops reads but lets an already submitted start/stop finish.
    func setSceneActive(_ active: Bool) {
        pollingTask?.cancel()
        pollingTask = nil
        refreshID = nil
        guard active else { return }
        historyDirty = true
        let interval = pollInterval
        pollingTask = Task { [weak self] in
            while !Task.isCancelled {
                guard self != nil else { return }
                await self?.refresh()
                do { try await Task.sleep(for: interval) } catch { return }
            }
        }
    }

    func refresh() async {
        guard !isMutating, refreshID == nil else { return }
        let token = UUID()
        refreshID = token
        let version = revision
        defer { if refreshID == token { refreshID = nil } }
        let sentAt = now()
        do {
            let state = try await api.state()
            guard !Task.isCancelled, revision == version, refreshID == token else { return }
            accept(state, sentAt: sentAt)
            availability = .live
        } catch {
            guard !Task.isCancelled, revision == version, refreshID == token else { return }
            availability = .unavailable(Self.failureMessage(error))
            return // Preserve the last known walk and history while offline.
        }
        if historyDirty { await refreshHistory(version: version) }
    }

    /// Repeated taps while a mutation is pending are ignored; the host disables controls with isMutating.
    func start(at date: Date) {
        guard activeWalk == nil, !isMutating else { return }
        let id = retryStartID ?? makeID()
        retryStartID = id // A lost response must not create a second walk when retried.
        activeWalk = DogWalk(id: id.uuidString.lowercased(), startedAt: serverNow(at: date), endedAt: nil, startedBy: device)
        begin(.start(id))
    }

    func stop(at date: Date) {
        guard let walk = activeWalk, !isMutating else { return }
        activeWalk = nil
        history.insert(DogWalk(id: walk.id, startedAt: walk.startedAt,
            endedAt: max(walk.startedAt, serverNow(at: date)), startedBy: walk.startedBy), at: 0)
        begin(.stop(walk.id))
    }

    private func begin(_ operation: Operation) {
        revision += 1
        refreshID = nil
        historyRequestID = nil
        isMutating = true
        hasAttemptedMutation = true
        let version = revision
        let sentAt = now()
        let source: WalkSource = switch device { case .iPhone: .iphone; case .iPad: .ipad; case .mac: .unknown }
        mutationTask = Task { [weak self, api] in
            do {
                let state: WalksState
                switch operation {
                case .start(let id): state = try await api.start(id: id, source: source)
                case .stop(let id): state = try await api.stop(id: id)
                }
                guard !Task.isCancelled, let self else { return }
                self.accept(state, sentAt: sentAt)
                self.history = self.confirmedHistory
                self.retryStartID = nil
                self.availability = .live
                self.isMutating = false
                self.mutationTask = nil
                self.historyDirty = true
                await self.refreshHistory(version: version)
            } catch {
                guard !Task.isCancelled, let self else { return }
                self.activeWalk = self.confirmedWalk
                self.history = self.confirmedHistory
                self.isMutating = false
                self.mutationTask = nil
                self.availability = .unavailable(Self.failureMessage(error))
            }
        }
    }

    private func accept(_ state: WalksState, sentAt: Date) {
        let receivedAt = now()
        // Midpoint estimate bounds the usual network latency error to roughly half a round trip.
        let midpoint = sentAt.addingTimeInterval(receivedAt.timeIntervalSince(sentAt) / 2)
        serverTimeOffset = state.serverTime.timeIntervalSince(midpoint)
        let walk = state.active.map(Self.map)
        // updatedAt has millisecond precision, so also compare the active record.
        if stateUpdatedAt != state.updatedAt || confirmedWalk != walk { historyDirty = true }
        stateUpdatedAt = state.updatedAt
        confirmedWalk = walk
        activeWalk = confirmedWalk
        hasLoadedState = true
        lastSyncedAt = receivedAt
        if state.active != nil { retryStartID = nil }
    }

    private func refreshHistory(version: Int) async {
        let token = UUID()
        historyRequestID = token
        do {
            let result = try await api.history()
            guard !Task.isCancelled, revision == version, !isMutating, historyRequestID == token else { return }
            confirmedHistory = result.walks.map(Self.map)
            history = confirmedHistory
            historyDirty = false
            historyAvailability = .live
        } catch {
            guard !Task.isCancelled, revision == version, historyRequestID == token else { return }
            historyDirty = true
            historyAvailability = .unavailable("Walk history is unavailable. Try again.")
        }
    }

    private static func map(_ walk: WalkRecord) -> DogWalk {
        // WalkDevice cannot express web/unknown. Preserve the exact source in WalkRecord;
        // .mac is the prototype's non-iOS display fallback (documented in the integration PR).
        let device: WalkDevice = switch walk.source { case .iphone: .iPhone; case .ipad: .iPad; case .web, .unknown: .mac }
        return DogWalk(id: walk.id, startedAt: walk.startedAt, endedAt: walk.endedAt, startedBy: device)
    }

    private static func failureMessage(_ error: any Error) -> String {
        if let error = error as? PanelAPIError, error == .notConfigured { return "The panel API is not configured." }
        return "Walks are unavailable. Showing the last known state."
    }

    private enum Operation { case start(UUID), stop(String) }
}
