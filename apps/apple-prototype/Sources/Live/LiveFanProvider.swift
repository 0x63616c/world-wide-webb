import Foundation
import Observation
import PanelKit

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
    private(set) var fanLabel: String?
    private(set) var pending: Set<String> = []
    private(set) var availability: LiveAvailability = .loading
    @ObservationIgnored private let api: FanAPI
    @ObservationIgnored private var busy = false

    init(api: FanAPI) { self.api = api }

    func refresh() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let snapshot = try await api.list()
            try Task.checkCancellation()
            accept(snapshot)
        } catch { fail(error) }
    }

    /// Serialize refreshes and mutations so a stale poll cannot overwrite a toggle.
    /// Wait for acknowledgement instead of inventing a climate mode or fan label.
    func toggle() async {
        guard !busy, let fanOn else { return }
        busy = true
        let previousPending = pending
        pending.insert("fan")
        defer { busy = false }
        do {
            let snapshot = try await api.toggle(on: !fanOn)
            try Task.checkCancellation()
            accept(snapshot)
        } catch {
            pending = previousPending
            fail(error)
        }
    }

    /// Apply only the fan field; target, mode, range and ambient belong to climate.
    func applying(to climate: ClimateState) -> ClimateState {
        var result = climate
        if let fanOn { result.fanOn = fanOn }
        return result
    }

    private func accept(_ snapshot: FanSnapshot) {
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
