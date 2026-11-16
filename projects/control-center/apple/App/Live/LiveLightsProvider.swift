import Foundation
import OSLog
import Observation
import PanelKit

/// An opt-in adapter; initialization never starts networking or changes the mock app.
@MainActor @Observable final class LiveLightsProvider {
    private(set) var lamps = LampState()
    private(set) var fanOn: Bool?
    private(set) var availability: LiveAvailability = .loading
    private(set) var pending: Set<String> = []

    @ObservationIgnored private let api: LightsAPI
    @ObservationIgnored private let fallbackLamps: LampState
    @ObservationIgnored private var serverState: ControlsState?
    @ObservationIgnored private var confirmedLamps = LampState()
    @ObservationIgnored private var confirmedFan: Bool?
    @ObservationIgnored private var acknowledgedPartySpeed: PartySpeed = .off
    @ObservationIgnored private var queue: [Operation] = []
    @ObservationIgnored private var mutationTask: Task<Void, Never>?
    @ObservationIgnored private let clock: SyncClock
    @ObservationIgnored private var pollingTask: Task<Void, Never>?
    @ObservationIgnored private var revision = 0
    @ObservationIgnored private var lifecycle = 0
    @ObservationIgnored private var refreshing = false

    init(api: LightsAPI, initialLamps: LampState = LampState(), clock: SyncClock = .continuous()) {
        self.clock = clock
        self.api = api
        fallbackLamps = initialLamps
        lamps = initialLamps
        confirmedLamps = initialLamps
    }

    deinit {
        mutationTask?.cancel()
        pollingTask?.cancel()
    }

    func refresh() async {
        guard queue.isEmpty, !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        let startedAt = revision
        do {
            let state = try await api.list()
            guard !Task.isCancelled, revision == startedAt else { return }
            accept(state)
            render()
            setAvailability(.live)
        } catch {
            guard !Task.isCancelled, revision == startedAt else { return }
            render()
            setAvailability(.unavailable(Self.failureMessage(error)))
        }
    }

    func startPolling(every interval: Duration = .seconds(30)) {
        guard interval > .zero else { return }
        pollingTask?.cancel()
        let clock = self.clock
        pollingTask = Task { [weak self] in
            while !Task.isCancelled {
                guard self != nil else { return }
                await self?.refresh()
                do { try await clock.sleep(interval) } catch { return }
            }
        }
    }

    /// Cancels polling and queued work, and restores the latest confirmed snapshot.
    func stop() {
        pollingTask?.cancel()
        pollingTask = nil
        mutationTask?.cancel()
        mutationTask = nil
        lifecycle += 1
        revision += 1
        for _ in queue { PanelCommandLog.shared.record(control: "lights.queued", error: "cancelled") }
        queue.removeAll()
        render()
    }

    @discardableResult func send(_ command: HomeCommand) -> Bool {
        let operation: Operation
        switch command {
        case .toggle(let accessory):
            let key = Self.key(for: accessory)
            // Group booleans cannot reconstruct the server's AND across individual lamps.
            let on = queue.isEmpty ? (serverState?.isOn(key) ?? localIsOn(accessory)) : localIsOn(accessory)
            operation = .toggle(key, !on)
        case .brightness(let pct):
            guard lamps.anyOn else { return false }
            operation = .brightness(min(100, max(0, pct)))
        case .kelvin(let kelvin):
            operation = .kelvin(min(6500, max(2000, kelvin)))
        case .scene(let value):
            guard let scene = PanelKit.LampScene(rawValue: value.lowercased()) else { return false }
            operation = .scene(scene)
        case .color(let index, let hex):
            guard Self.slots.indices.contains(index), hex.map(LightsAPI.isValidColor) ?? true else { return false }
            operation = .color(Self.slots[index], hex)
        case .party(let speed):
            guard speed == .off || lamps.anyOn else { return false }
            operation = .party(speed)
        default: return false
        }
        queue.append(operation)
        revision += 1
        render()
        beginMutationsIfNeeded()
        return true
    }

    private func beginMutationsIfNeeded() {
        guard mutationTask == nil else { return }
        let startedIn = lifecycle
        mutationTask = Task { [weak self, api] in
            while !Task.isCancelled, let operation = self?.queue.first {
                do {
                    let state = try await operation.perform(api)
                    guard !Task.isCancelled else { return }
                    self?.finish(operation, state: state, lifecycle: startedIn)
                } catch {
                    guard !Task.isCancelled else { return }
                    self?.fail(error, lifecycle: startedIn)
                    return
                }
            }
        }
    }

    private func finish(_ operation: Operation, state: ControlsState, lifecycle: Int) {
        guard self.lifecycle == lifecycle, !queue.isEmpty else { return }
        if case .party(let speed) = operation, speed != .off, state.lamps.activeScene == .party {
            acknowledgedPartySpeed = speed
        }
        queue.removeFirst()
        accept(state)
        render()
        setAvailability(.live)
        if queue.isEmpty { mutationTask = nil }
    }

    private func fail(_ error: any Error, lifecycle: Int) {
        guard self.lifecycle == lifecycle else { return }
        Logger(subsystem: "co.worldwidewebb.panel", category: "commands").error("Lights provider request failed")
        for _ in queue.dropFirst() {
            PanelCommandLog.shared.record(control: "lights.queued", error: "dropped: action unavailable")
        }
        queue.removeAll()
        mutationTask = nil
        render()
        setAvailability(.unavailable(Self.failureMessage(error)))
    }

    private func accept(_ state: ControlsState) {
        serverState = state
        // These are group projections, NOT eight independently observed lamp states.
        for index in 0..<3 { confirmedLamps.on[index] = state.bedroomLamps.on }
        for index in 3..<8 { confirmedLamps.on[index] = state.otherLamps.on }
        confirmedLamps.ceiling = state.ceiling.on
        confirmedLamps.cabinet = state.cabinet.on
        confirmedLamps.brightness = state.lamps.brightness
        confirmedLamps.kelvin = state.lamps.whiteKelvin
        confirmedLamps.colors = fallbackLamps.colors
        for color in state.lamps.savedColors {
            if let index = Self.slots.firstIndex(of: color.slot) { confirmedLamps.colors[index] = color.hex }
        }
        confirmedLamps.scene = state.lamps.activeScene?.rawValue.capitalized ?? fallbackLamps.scene
        confirmedLamps.activeColor = state.lamps.colorSlot.flatMap(Self.slots.firstIndex)
        let reportedSpeed: PartySpeed? =
            switch state.lamps.speed {
            case .slow: .slow
            case .medium: .medium
            case .fast: .fast
            case nil: nil
            }
        confirmedLamps.party = state.lamps.activeScene == .party ? reportedSpeed ?? acknowledgedPartySpeed : .off
        confirmedFan = state.fan.on
    }

    /// Rebase outstanding optimistic edits on each acknowledged full-state response.
    /// Builds the projection locally and assigns only changes: polls repeat identical
    /// samples, and each Observation set would invalidate every lights reader.
    private func render() {
        var lamps = confirmedLamps
        var fanOn = confirmedFan
        var pending = serverState?.pendingKeys ?? []
        for operation in queue {
            Self.applyOptimistically(operation, to: &lamps, fanOn: &fanOn)
            pending.insert(operation.pendingKey)
        }
        if self.lamps != lamps { self.lamps = lamps }
        if self.fanOn != fanOn { self.fanOn = fanOn }
        if self.pending != pending { self.pending = pending }
    }

    private func setAvailability(_ value: LiveAvailability) {
        if availability != value { availability = value }
    }

    private static func applyOptimistically(_ operation: Operation, to lamps: inout LampState, fanOn: inout Bool?) {
        switch operation {
        case .toggle(let key, let on):
            switch key {
            case .lamps: lamps.on = Array(repeating: on, count: 8)
            case .bedroomLamps: for i in 0..<3 { lamps.on[i] = on }
            case .otherLamps: for i in 3..<8 { lamps.on[i] = on }
            case .all:
                lamps.on = Array(repeating: on, count: 8)
                lamps.ceiling = on
                lamps.cabinet = on
            case .lights:
                lamps.ceiling = on
                lamps.cabinet = on
            case .ceiling: lamps.ceiling = on
            case .cabinet: lamps.cabinet = on
            case .fan: fanOn = on
            }
            if !lamps.anyOn { lamps.party = .off }
        case .brightness(let pct):
            lamps.brightness = pct
            lamps.on = Array(repeating: true, count: 8)
        case .kelvin(let kelvin):
            lamps.kelvin = kelvin
            if lamps.anyOn { applyScene(.white, to: &lamps) }
        case .scene(let scene): applyScene(scene, to: &lamps)
        case .color(let slot, let hex):
            guard let index = Self.slots.firstIndex(of: slot) else { return }
            if let hex { lamps.colors[index] = hex.lowercased() }
            lamps.on = Array(repeating: true, count: 8)
            lamps.brightness = 100
            lamps.activeColor = index
            lamps.scene = "Custom \(index + 1)"
            lamps.party = .off
        case .party(let speed):
            lamps.party = speed
            lamps.activeColor = nil
        }
    }

    private static func applyScene(_ scene: PanelKit.LampScene, to lamps: inout LampState) {
        lamps.scene = scene.rawValue.capitalized
        lamps.activeColor = nil
        lamps.party = .off
        lamps.on = Array(repeating: true, count: 8)
        if scene == .red { lamps.brightness = 100 }
    }

    private func localIsOn(_ accessory: Accessory) -> Bool {
        accessory == .fan ? (fanOn ?? false) : lamps.isOn(accessory)
    }

    private static let slots: [LampColorSlot] = [.red, .blue, .custom]

    private static func key(for accessory: Accessory) -> ControlKey {
        switch accessory {
        case .all: .all
        case .fan: .fan
        case .lamps: .lamps
        case .bedroom: .bedroomLamps
        case .livingRoom: .otherLamps
        case .lights: .lights
        case .ceiling: .ceiling
        case .cabinet: .cabinet
        }
    }

    private static func failureMessage(_ error: any Error) -> String {
        panelFailureReason(error, fallback: "Lights are unavailable. Try again.")
    }

    private enum Operation {
        case toggle(ControlKey, Bool)
        case brightness(Int)
        case kelvin(Int)
        case scene(PanelKit.LampScene)
        case color(LampColorSlot, String?)
        case party(PartySpeed)

        var pendingKey: String {
            if case .toggle(let key, _) = self { return key.rawValue }
            return ControlKey.lamps.rawValue
        }

        func perform(_ api: LightsAPI) async throws -> ControlsState {
            switch self {
            case .toggle(let key, let on): return try await api.toggle(key, on: on)
            case .brightness(let pct): return try await api.setBrightness(pct: pct)
            case .kelvin(let kelvin): return try await api.setWhiteKelvin(kelvin)
            case .scene(let scene): return try await api.setScene(scene)
            case .color(let slot, let hex): return try await api.setColor(slot: slot, hex: hex)
            case .party(let speed):
                let wireSpeed: LampModeSpeed? =
                    switch speed {
                    case .off: nil
                    case .slow: .slow
                    case .medium: .medium
                    case .fast: .fast
                    }
                return try await api.setMode(speed == .off ? .none : .party, speed: wireSpeed)
            }
        }
    }
}
