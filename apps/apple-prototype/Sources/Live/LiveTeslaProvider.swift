import Foundation
import Observation
import PanelKit

/// No fixture defaults escape this provider. Hybrid requires a current complete
/// snapshot before mounting the unchanged Tesla views.
@MainActor @Observable final class LiveTeslaProvider: TeslaProvider {
    private(set) var snapshot: TeslaSnapshot?
    private(set) var hasLiveData = false
    private(set) var requestedAction: TeslaAction?
    private(set) var busy = false
    private(set) var errorMessage: String?
    @ObservationIgnored private let api: TeslaAPI
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private var mutation: Task<Void, Never>?

    init(api: TeslaAPI) { self.api = api }
    var availability: TeslaAvailability { hasLiveData ? .online : .offline }
    var data: TeslaData {
        guard hasLiveData, let snapshot else {
            return TeslaData(name: "Unavailable", nick: "Car", place: "", charging: false,
                chargingState: "", preconditioning: false, rate: 0, pct: 0, range: 0, odo: "", climate: 0)
        }
        return TeslaData(name: "Tesla", nick: "Car", place: "",
            charging: snapshot.chargingState == .charging, chargingState: snapshot.chargingState.rawValue,
            preconditioning: snapshot.climateOn, rate: snapshot.chargePowerKW,
            pct: Int(snapshot.batteryPercent.rounded()), range: Int(snapshot.rangeMiles.rounded()),
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
        mutation = Task { [weak self] in
            await self?.confirm(pin: pin)
            self?.mutation = nil
        }
    }

    func confirm(pin: String) async {
        guard hasLiveData, !busy, let action = requestedAction else { return }
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
            } else if case .decoding = error as? PanelAPIError {
                errorMessage = "Enter the six-digit panel PIN."
            } else {
                hasLiveData = false
                requestedAction = nil
                errorMessage = "Tesla is unavailable."
            }
        }
    }

    private func accept(_ state: TeslaState) {
        if case .ready(let value) = state { snapshot = value; hasLiveData = true }
        else { snapshot = nil; hasLiveData = false; requestedAction = nil }
    }
    func stop() {
        generation += 1
        mutation?.cancel()
        mutation = nil
        busy = false
        hasLiveData = false
        cancelCommand()
    }
}
