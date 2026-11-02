import Foundation
import Observation
import PanelKit

/// No fixture defaults escape this provider. Hybrid requires a current complete
/// snapshot before mounting the unchanged Tesla views.
@MainActor @Observable final class LiveTeslaProvider: TeslaProvider {
    private(set) var moduleStatus: HomeModuleStatus = .loading
    private(set) var snapshot: TeslaSnapshot?
    private(set) var hasLiveData = false
    private(set) var requestedAction: TeslaAction?
    private(set) var busy = false
    private(set) var errorMessage: String?
    @ObservationIgnored private let api: TeslaAPI
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var mutation: Task<Void, Never>?

    /// Full-charge range estimate (range ÷ battery %), rounded to 5 mi. Below 10% the
    /// estimate gets noisy, so the last good value is held and persisted across launches.
    private(set) var maxRange: Int
    @ObservationIgnored private let defaults: UserDefaults
    static let maxRangeKey = "teslaMaxRangeMiles"

    init(api: TeslaAPI, defaults: UserDefaults = .standard) {
        self.api = api; self.defaults = defaults
        maxRange = defaults.integer(forKey: Self.maxRangeKey)
    }
    static func estimateMaxRange(rangeMiles: Double, batteryPercent: Double) -> Int? {
        guard batteryPercent >= 10, rangeMiles > 0 else { return nil }
        return Int((rangeMiles * 100 / batteryPercent / 5).rounded()) * 5
    }
    var availability: TeslaAvailability { hasLiveData ? .online : .offline }
    var data: TeslaData {
        guard hasLiveData, let snapshot else {
            return TeslaData(name: "Unavailable", nick: "Car", place: "", charging: false,
                chargingState: "", preconditioning: false, rate: 0, pct: 0, range: 0, maxRange: 0, odo: "", climate: 0)
        }
        return TeslaData(name: "Tesla", nick: "Car", place: "",
            charging: snapshot.chargingState == .charging, chargingState: snapshot.chargingState.rawValue,
            preconditioning: snapshot.climateOn, rate: snapshot.chargePowerKW,
            pct: Int(snapshot.batteryPercent.rounded()), range: Int(snapshot.rangeMiles.rounded()),
            maxRange: maxRange,
            locked: snapshot.locked,
            odo: Int(snapshot.odometerMiles.rounded()).formatted(), climate: Int(snapshot.cabinFahrenheit.rounded()))
    }

    func refresh() async {
        guard !busy else { return }
        busy = true
        let version = generation
        defer { if version == generation { busy = false } }
        do {
            let state = try await api.state()
            try Task.checkCancellation()
            guard version == generation else { return }
            accept(state)
        } catch {
            guard version == generation else { return }
            hasLiveData = false
            moduleStatus = .unavailable(panelFailureReason(error, fallback: "Tesla is unavailable"))
            requestedAction = nil
        }
    }

    /// Existing view bindings only stage a command. No network write precedes PIN confirmation.
    func send(_ command: TeslaCommand) {
        switch command {
        case .setCharging(let on): request(on ? .chargeStart : .chargeStop)
        case .setPreconditioning(let on): request(on ? .climateOn : .climateOff)
        }
    }
    func request(_ action: TeslaAction) {
        guard hasLiveData, !busy, requestedAction == nil else { return }
        requestedAction = action
        errorMessage = nil
    }
    func cancelCommand() { requestedAction = nil; errorMessage = nil }

    func submit(pin: String) {
        guard mutation == nil else { return }
        let version = generation
        mutation = Task { [weak self] in
            await self?.confirm(pin: pin)
            if self?.generation == version { self?.mutation = nil }
        }
    }

    func confirm(pin: String) async {
        guard hasLiveData, !busy, let action = requestedAction else { return }
        guard pin.utf8.count == 6, pin.utf8.allSatisfy({ (48...57).contains($0) }) else {
            errorMessage = "Enter the six-digit panel PIN."
            return
        }
        busy = true
        let version = generation
        defer { if version == generation { busy = false } }
        do {
            try await api.command(action, pin: pin)
            try Task.checkCancellation()
            guard version == generation else { return }
            requestedAction = nil
            errorMessage = nil
            // Acknowledgement never invents vehicle state. Read HA again; later
            // polls handle eventual consistency without retrying the command.
            let state = try await api.state()
            try Task.checkCancellation()
            guard version == generation else { return }
            accept(state)
        } catch {
            guard version == generation else { return }
            if case .server(let code, _, _) = error as? PanelAPIError, code == "FORBIDDEN" {
                errorMessage = "PIN not accepted. Try again."
            } else {
                hasLiveData = false
                moduleStatus = .unavailable(panelFailureReason(error, fallback: "Tesla is unavailable"))
                requestedAction = nil
                errorMessage = "Tesla is unavailable."
            }
        }
    }

    private func accept(_ state: TeslaState) {
        switch state {
        case .ready: moduleStatus = .live
        case .unconfigured: moduleStatus = .unconfigured("Tesla isn't set up on the server")
        case .unavailable: moduleStatus = .unavailable("Tesla is unavailable on the server")
        }
        if case .ready(let value) = state {
            snapshot = value; hasLiveData = true
            if let estimate = Self.estimateMaxRange(rangeMiles: value.rangeMiles, batteryPercent: value.batteryPercent), estimate != maxRange {
                maxRange = estimate
                defaults.set(estimate, forKey: Self.maxRangeKey)
            }
        }
        else { snapshot = nil; hasLiveData = false; requestedAction = nil }
    }
    func stop() {
        generation += 1
        mutation?.cancel()
        mutation = nil
        busy = false
        hasLiveData = false
        moduleStatus = .loading
        cancelCommand()
    }
}
