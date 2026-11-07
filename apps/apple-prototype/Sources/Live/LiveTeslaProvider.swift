import Foundation
import Observation
import PanelKit

/// Keep the last complete reported snapshot visible when the car or network sleeps.
@MainActor @Observable final class LiveTeslaProvider: TeslaProvider {
    private(set) var moduleStatus: HomeModuleStatus = .loading
    private(set) var snapshot: TeslaSnapshot?
    private(set) var hasLiveData = false
    private(set) var requestedAction: TeslaAction?
    private(set) var busy = false
    private(set) var errorMessage: String?
    private(set) var acknowledgedAction: TeslaAction?
    var commandNotice: String? {
        switch acknowledgedAction {
        case .lock: "Lock requested"
        case .unlock: "Unlock requested"
        default: nil
        }
    }
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
    var availability: TeslaAvailability { hasLiveData && snapshot?.stale != true && snapshot?.vehicleOnline != false ? .online : .offline }
    var data: TeslaData {
        guard hasLiveData, let snapshot else {
            return TeslaData(name: "Unavailable", nick: "Tesla", place: "", charging: false,
                chargingState: "", preconditioning: false, rate: 0, pct: 0, range: 0, maxRange: 0, odo: "", climate: 0)
        }
        return TeslaData(name: "Model Y", nick: "Evee", place: "",
            charging: snapshot.chargingState == .charging, chargingState: snapshot.chargingState.rawValue,
            preconditioning: snapshot.climateOn, rate: snapshot.chargePowerKW,
            pct: Int(snapshot.batteryPercent.rounded()), range: Int(snapshot.rangeMiles.rounded()),
            maxRange: maxRange,
            locked: snapshot.locked,
            odo: Int(snapshot.odometerMiles.rounded()).formatted(), climate: Int(snapshot.cabinFahrenheit.rounded()),
            softwareUpdate: snapshot.softwareUpdate,
            driveState: snapshot.driveState,
            cableConnected: snapshot.cableConnected,
            chargeLimitPercent: snapshot.chargeLimitPercent,
            chargeCompleteAt: TeslaData.date(snapshot.chargeCompleteAt),
            lastUpdatedAt: TeslaData.date(snapshot.lastUpdatedAt))
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
            retainSnapshot(reason: panelFailureReason(error, fallback: "Tesla is unavailable"))
        }
    }

    var canControl: Bool {
        hasLiveData && availability == .online && !data.isInGear && !data.isInstalling
    }

    func request(_ action: TeslaAction) {
        guard action == .lock || action == .unlock else { return }
        guard canControl, !busy, requestedAction == nil else { return }
        requestedAction = action
        acknowledgedAction = nil
        errorMessage = nil
    }
    func cancelCommand() { requestedAction = nil; errorMessage = nil }

    func submit(pin: String) {
        _ = startSubmission(pin: pin)
    }

    /// The keypad may disappear as soon as the command is acknowledged. Its
    /// view task can wait, but must not own/cancel the command's follow-up read.
    func submitAndWait(pin: String) async -> String? {
        guard let task = startSubmission(pin: pin) else { return errorMessage }
        await task.value
        return errorMessage
    }

    private func startSubmission(pin: String) -> Task<Void, Never>? {
        guard mutation == nil else { return nil }
        let version = generation
        mutation = Task { [weak self] in
            await self?.confirm(pin: pin)
            if self?.generation == version { self?.mutation = nil }
        }
        return mutation
    }

    func confirm(pin: String) async {
        guard canControl, !busy, let action = requestedAction else { return }
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
            acknowledgedAction = action
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
                retainSnapshot(reason: panelFailureReason(error, fallback: "Tesla is unavailable"))
                errorMessage = "Tesla is unavailable."
            }
        }
    }

    private func retainSnapshot(reason: String) {
        acknowledgedAction = nil
        snapshot?.stale = true
        hasLiveData = snapshot != nil
        moduleStatus = hasLiveData ? .live : .unavailable(reason)
        requestedAction = nil
    }

    private func accept(_ state: TeslaState) {
        switch state {
        case .ready(let value):
            snapshot = value; hasLiveData = true; moduleStatus = .live
            if !canControl { requestedAction = nil; acknowledgedAction = nil }
            if (acknowledgedAction == .lock && value.locked) || (acknowledgedAction == .unlock && !value.locked) {
                acknowledgedAction = nil
            }
            if let estimate = Self.estimateMaxRange(rangeMiles: value.rangeMiles, batteryPercent: value.batteryPercent), estimate != maxRange {
                maxRange = estimate
                defaults.set(estimate, forKey: Self.maxRangeKey)
            }
        case .unconfigured:
            acknowledgedAction = nil
            snapshot = nil; hasLiveData = false; requestedAction = nil
            moduleStatus = .unconfigured("Tesla isn't set up on the server")
        case .unavailable:
            retainSnapshot(reason: "Tesla is unavailable on the server")
        }
    }
    func stop() {
        generation += 1
        mutation?.cancel()
        mutation = nil
        busy = false
        hasLiveData = false
        moduleStatus = .loading
        acknowledgedAction = nil
        cancelCommand()
    }
}
