import Foundation
import Observation
import PanelKit
import OSLog

@MainActor protocol FanProvider: AnyObject, Observable {
    var fanOn: Bool? { get }
    var fanLabel: String? { get }
    var pending: Set<String> { get }
    var availability: LiveAvailability { get }
    func refresh() async
    func toggle() async
}

/// Opt-in data adapter. The host owns polling and routes .toggle(.fan) here.
/// No network request runs at initialization; unavailable data never becomes a fixture.
@MainActor @Observable final class LiveFanProvider: FanProvider {
    private(set) var fanOn: Bool?
    private(set) var fanModes: [String] = ["auto", "on"]
    private(set) var selectedMode: String?
    private(set) var fanLabel: String?
    private(set) var pending: Set<String> = []
    private(set) var availability: LiveAvailability = .loading
    @ObservationIgnored private let api: FanAPI
    private(set) var errorMessage: String?
    private(set) var errorRevision = 0
    @ObservationIgnored private var refreshing = false
    @ObservationIgnored private var revision = 0
    @ObservationIgnored private var queue: [(revision: Int, mode: String, usesToggle: Bool)] = []
    @ObservationIgnored private var mutation: Task<Void, Never>?
    @ObservationIgnored private var acknowledged: FanSnapshot?
    @ObservationIgnored private var runID: UUID?

    init(api: FanAPI) { self.api = api }
    deinit { mutation?.cancel() }

    func refresh() async {
        guard !refreshing, mutation == nil else { return }
        refreshing = true
        let startedAt = revision
        defer { refreshing = false }
        do {
            let snapshot = try await api.list()
            guard !Task.isCancelled, revision == startedAt else { return }
            acknowledged = snapshot
            accept(snapshot)
        } catch {
            guard !Task.isCancelled, revision == startedAt else { return }
            fail(error)
        }
    }

    /// Select an absolute intent. Serialize writes, but update immediately, including
    /// when a poll is in flight. Old responses cannot replace a newer selection.
    func setOn(_ on: Bool) {
        enqueue(mode: on ? "on" : "auto", usesToggle: true)
    }

    func setMode(_ mode: String) {
        guard fanModes.contains(mode) else {
            errorMessage = "This fan mode is unavailable. Refresh and try again."
            errorRevision += 1
            Logger(subsystem: "co.worldwidewebb.panel", category: "commands").error("Unsupported fan mode")
            return
        }
        // Auto/On retain the established endpoint for older servers. A real
        // Off is offered only after the server advertises the new capability.
        enqueue(mode: mode, usesToggle: mode != "off")
    }

    private func enqueue(mode: String, usesToggle: Bool) {
        guard fanOn != nil else { return }
        revision += 1
        errorMessage = nil
        fanOn = mode == "on"
        selectedMode = mode
        fanLabel = mode.capitalized
        pending.insert("fan")
        queue.append((revision, mode, usesToggle))
        guard mutation == nil else { return }
        let id = UUID()
        runID = id
        mutation = Task { [weak self] in
            guard let self else { return }
            await self.drain(id: id)
        }
    }

    func toggle() async {
        guard let fanOn else { return }
        setOn(!fanOn)
        await mutation?.value
    }

    private func drain(id: UUID) async {
        defer { if runID == id { mutation = nil } }
        while !Task.isCancelled && !queue.isEmpty {
            let command = queue.removeFirst()
            do {
                let snapshot: FanSnapshot
                if command.usesToggle { snapshot = try await api.toggle(on: command.mode == "on") }
                else { snapshot = try await api.setMode(command.mode) }
                try Task.checkCancellation()
                acknowledged = snapshot
                if revision == command.revision { accept(snapshot) }
            } catch {
                guard !Task.isCancelled else { return }
                if revision == command.revision, let acknowledged { accept(acknowledged) }
                if !(error is CancellationError) {
                    // Keep the restored controls live so the user can retry. Never
                    // expose server errors, which can include runtime credentials.
                    Logger(subsystem: "co.worldwidewebb.panel", category: "commands").error("Fan backend command failed")
                    errorMessage = "Couldn’t change the fan. Try again."
                    errorRevision += 1
                }
            }
        }
    }

    func stop() {
        revision += 1
        runID = nil
        mutation?.cancel()
        mutation = nil
        queue.removeAll()
        if let acknowledged { accept(acknowledged) }
    }

    /// Apply only the fan field; target, mode, range and ambient belong to climate.
    func applying(to climate: ClimateState) -> ClimateState {
        var result = climate
        if let fanOn { result.fanOn = fanOn }
        return result
    }

    private func accept(_ snapshot: FanSnapshot) {
        fanModes = snapshot.fan.modes ?? ["auto", "on"]
        selectedMode = snapshot.fan.mode ?? (snapshot.fan.on ? "on" : "auto")
        fanOn = snapshot.fan.on
        // The server distinguishes Auto from Off using the effective A/C mode.
        fanLabel = snapshot.fan.sub
        pending = snapshot.fan.pending ? ["fan"] : []
        availability = .live
    }

    private func fail(_ error: any Error) {
        if error is CancellationError { return }
        // Never expose transport/server messages, which may contain runtime credentials.
        if let error = error as? PanelAPIError, error == .notConfigured {
            availability = .unavailable("The panel API is not configured.")
        } else {
            availability = .unavailable("Fan is unavailable. Try again.")
        }
    }
}

/// Explicit preview fallback; the app's existing MockHomeDataSource remains the default.
@MainActor @Observable final class MockFanProvider: FanProvider {
    var climate: ClimateState
    var fanOn: Bool? { climate.fanOn }
    var fanLabel: String? { climate.fanLabel }
    var pending: Set<String> { [] }
    var availability: LiveAvailability { .live }
    init(climate: ClimateState = ClimateState()) { self.climate = climate }
    func refresh() async {}
    func toggle() async { climate.fanOn.toggle() }
}
