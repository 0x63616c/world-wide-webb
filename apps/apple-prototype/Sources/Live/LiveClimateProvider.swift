import Foundation
import Observation
import PanelKit

@MainActor protocol ClimateProvider: AnyObject, Observable {
    var climate: ClimateState? { get }
    var availability: LiveAvailability { get }
    var pending: Set<String> { get }
    func refresh() async
    @discardableResult func send(_ command: HomeCommand) -> Bool
}

/// Opt-in only. No networking at initialization and no invented initial readings.
@MainActor @Observable final class LiveClimateProvider: ClimateProvider {
    private(set) var climate: ClimateState?
    private(set) var reportedAction: ClimateAction?
    private(set) var ambientFahrenheit: Double?
    private(set) var availability: LiveAvailability = .loading
    private(set) var pending: Set<String> = []
    private(set) var lastError: PanelAPIError?
    @ObservationIgnored private let api: ClimateAPI
    @ObservationIgnored private var queue: [HomeCommand] = []
    @ObservationIgnored private var mutationTask: Task<Void, Never>?
    @ObservationIgnored private var pollingTask: Task<Void, Never>?
    @ObservationIgnored private var revision = 0
    @ObservationIgnored private var refreshing = false

    init(api: ClimateAPI) { self.api = api }
    deinit { mutationTask?.cancel(); pollingTask?.cancel() }

    func refresh() async {
        guard queue.isEmpty, !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        let startedAt = revision
        do {
            let state = try await api.get()
            guard !Task.isCancelled, revision == startedAt else { return }
            accept(state)
        } catch {
            guard !Task.isCancelled, revision == startedAt else { return }
            fail(error)
        }
    }

    func startPolling(every interval: Duration = .seconds(30)) {
        guard interval > .zero else { return }
        pollingTask?.cancel()
        pollingTask = Task { [weak self] in
            while !Task.isCancelled {
                guard self != nil else { return }
                await self?.refresh()
                do { try await Task.sleep(for: interval) } catch { return }
            }
        }
    }

    func stop() {
        pollingTask?.cancel(); pollingTask = nil
        mutationTask?.cancel(); mutationTask = nil
        revision += 1
        queue.removeAll(); pending = []
    }

    @discardableResult func send(_ command: HomeCommand) -> Bool {
        switch command {
        case .mode, .target, .low, .high, .shiftRange: break
        default: return false
        }
        // Range edits require real confirmed setpoints, never the prototype fixture.
        guard climate != nil else { return false }
        queue.append(command)
        revision += 1
        pending = ["climate"]
        guard mutationTask == nil else { return true }
        mutationTask = Task { [weak self] in
            while !Task.isCancelled, let self, let command = self.queue.first {
                do {
                    let state = try await self.perform(command)
                    guard !Task.isCancelled else { return }
                    self.accept(state)
                    self.queue.removeFirst()
                    if self.queue.isEmpty { self.pending = []; self.mutationTask = nil }
                } catch {
                    guard !Task.isCancelled else { return }
                    self.queue.removeAll(); self.pending = []; self.mutationTask = nil
                    self.fail(error)
                    return
                }
            }
        }
        return true
    }

    private func perform(_ command: HomeCommand) async throws -> ClimateAPIState {
        guard let climate else { throw PanelAPIError.notConfigured }
        switch command {
        case .mode(let mode): return try await api.setMode(ClimateAPIMode(rawValue: mode.rawValue)!)
        case .target(let target): return try await api.setTarget(target)
        case .low(let low): return try await api.setRange(low: low, high: climate.high)
        case .high(let high): return try await api.setRange(low: climate.low, high: high)
        case .shiftRange(let delta):
            // Preserve width at the boundaries, matching MockHomeDataSource.
            let step = min(77 - climate.high, max(67 - climate.low, delta))
            return try await api.setRange(low: climate.low + step, high: climate.high + step)
        default: preconditionFailure("Unsupported climate command")
        }
    }

    private func accept(_ state: ClimateAPIState) {
        var mapped = climate ?? ClimateState()
        mapped.mode = ClimateMode(rawValue: state.mode.rawValue)!
        mapped.ambient = Int(state.ambient.rounded())
        switch state.setpoints {
        case .single(let target):
            mapped.target = target
            (mapped.low, mapped.high) = Self.range(around: target)
        case .range(let low, let high):
            mapped.low = low; mapped.high = high
            mapped.target = Int((Double(low + high) / 2).rounded())
        case .off(let target, let low, let high):
            if let target { mapped.target = Int(target.rounded()) }
            if let low, let high { mapped.low = Int(low.rounded()); mapped.high = Int(high.rounded()) }
            else if let target { (mapped.low, mapped.high) = Self.range(around: Int(target.rounded())) }
        }
        // fanOn is not exposed by climate.get; do not infer fan activity from HVAC action.
        climate = mapped
        reportedAction = state.action
        ambientFahrenheit = state.ambient
        lastError = nil
        availability = .live
    }

    private static func range(around target: Int) -> (Int, Int) {
        let low = min(75, max(67, target - 3))
        return (low, min(77, max(low + 2, target + 3)))
    }

    private func fail(_ error: any Error) {
        lastError = error as? PanelAPIError
        availability = .unavailable(lastError?.localizedDescription ?? "Climate is unavailable. Try again.")
    }
}

/// Preview fallback remains backed by the existing fixture source, without networking.
@MainActor @Observable final class MockClimateProvider: ClimateProvider {
    private let source: MockHomeDataSource
    var climate: ClimateState? { source.climate }
    var availability: LiveAvailability { .live }
    var pending: Set<String> { source.pending.intersection(["climate"]) }
    init(source: MockHomeDataSource = MockHomeDataSource()) { self.source = source }
    func refresh() async {}
    @discardableResult func send(_ command: HomeCommand) -> Bool {
        switch command {
        case .mode, .target, .low, .high, .shiftRange: source.send(command); return true
        default: return false
        }
    }
}
