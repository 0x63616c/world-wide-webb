import Foundation
import Observation
import PanelKit

@MainActor protocol SonosProvider: AnyObject, Observable {
    var rooms: [SoundRoom] { get }
    var availability: LiveAvailability { get }
    var pending: Set<String> { get }
    var globalLock: Bool { get }
    var groupLock: Bool { get }
    var supportsPlaybackPosition: Bool { get }
    func refresh() async
    @discardableResult func send(_ command: HomeCommand) -> Bool
}

/// Explicit opt-in only. Construct with runtime PanelConfiguration; no networking in init.
///
/// Playback is projected from the current coordinator. Missing or partial samples
/// remain unavailable; writes are serialized and confirmed by a fresh query.
@MainActor @Observable final class LiveSonosProvider: SonosProvider {
    private(set) var rooms: [SoundRoom] = []
    private(set) var roomDetails: [String: SonosRoom] = [:]
    private(set) var diagnostics: SonosSoundSystem.Diagnostics?
    private(set) var availability: LiveAvailability = .loading
    private(set) var pending: Set<String> = []
    private(set) var globalLock = false
    private(set) var groupLock = false
    var supportsPlaybackPosition: Bool { rooms.contains { playback(for: $0.id) != nil } }

    func playback(for id: String) -> SonosPlaybackPosition? {
        guard availability == .live, let room = availableRoom(id),
              let leader = availableRoom(room.coordinatorUuid) else { return nil }
        return leader.playbackPosition
    }

    enum SourceAction { case lineIn, tv, joinAllToTV }

    @discardableResult func selectSource(_ action: SourceAction, room id: String) -> Bool {
        guard availability == .live, availableRoom(id) != nil else { return false }
        return enqueue(.source(id, action))
    }

    @ObservationIgnored private let lockDefaults: UserDefaults?
    @ObservationIgnored private let api: SonosAPI
    @ObservationIgnored private var confirmedRooms: [SoundRoom] = []
    @ObservationIgnored private var queue: [Operation] = []
    @ObservationIgnored private var mutationTask: Task<Void, Never>?
    @ObservationIgnored private var pollingTask: Task<Void, Never>?
    @ObservationIgnored private var revision = 0
    @ObservationIgnored private var lifecycle = 0
    @ObservationIgnored private var refreshing = false

    init(api: SonosAPI, lockDefaults: UserDefaults? = nil) {
        self.api = api
        self.lockDefaults = lockDefaults
        globalLock = lockDefaults?.bool(forKey: "sonos.globalVolumeLock") ?? false
        groupLock = lockDefaults?.bool(forKey: "sonos.groupVolumeLock") ?? false
    }

    private func persistLocks() {
        lockDefaults?.set(globalLock, forKey: "sonos.globalVolumeLock")
        lockDefaults?.set(groupLock, forKey: "sonos.groupVolumeLock")
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
            let state = try await api.soundSystem()
            guard !Task.isCancelled, startedAt == revision else { return }
            accept(state)
            availability = .live
        } catch {
            guard !Task.isCancelled, startedAt == revision else { return }
            availability = .unavailable(Self.failureMessage(error))
        }
    }

    func startPolling(every interval: Duration = .seconds(10)) {
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
        pollingTask?.cancel()
        pollingTask = nil
        mutationTask?.cancel()
        mutationTask = nil
        lifecycle += 1
        revision += 1
        for _ in queue { PanelCommandLog.shared.record(control: "sonos.queued", error: "cancelled") }
        queue.removeAll()
        render()
    }

    @discardableResult func send(_ command: HomeCommand) -> Bool {
        guard availability == .live else { return false }
        let operation: Operation
        switch command {
        case .globalLock:
            globalLock.toggle(); persistLocks()
            PanelCommandLog.shared.record(control: "sonos.globalLock")
            return true
        case .groupLock:
            groupLock.toggle(); persistLocks()
            PanelCommandLog.shared.record(control: "sonos.groupLock")
            return true
        case .volume(let id, let value):
            guard let room = availableRoom(id) else { return false }
            let ids = confirmedRooms.compactMap { candidate -> String? in
                guard availableRoom(candidate.id) != nil,
                      globalLock || candidate.id == id || (groupLock && candidate.coordinator == room.coordinatorUuid)
                else { return nil }
                return candidate.id
            }
            operation = .volume(ids, min(100, max(0, value)), raw: false)
        case .rawVolume(let id, let value):
            guard availableRoom(id) != nil else { return false }
            operation = .volume([id], min(100, max(0, value)), raw: true)
        case .mute(let id):
            guard availableRoom(id) != nil, let room = rooms.first(where: { $0.id == id }) else { return false }
            operation = .mute(id, !room.muted)
        case .transport(let id, let command):
            guard availableRoom(id) != nil, let value = SonosTransportCommand(rawValue: command.rawValue) else { return false }
            operation = .transport(id, value)
        case .seek(let id, let seconds):
            guard seconds.isFinite, let sample = playback(for: id) else { return false }
            operation = .seek(id, min(sample.duration, max(0, seconds)))
        case .join(let id, let target):
            guard id != target, availableRoom(id) != nil, availableRoom(target) != nil else { return false }
            operation = .join(id, target)
        case .joinAll(let target):
            guard availableRoom(target) != nil else { return false }
            operation = .joinAll(target)
        case .leave(let id):
            guard availableRoom(id) != nil else { return false }
            operation = .leave(id)
        case .calibrate:
            guard !roomDetails.isEmpty else { return false }
            operation = .calibrate
        case .clearCalibration:
            guard !roomDetails.isEmpty else { return false }
            operation = .clearCalibration
        // A false result must not fall through to MockHomeDataSource for live Sonos commands.
        // Fixture-library playback has no backend procedure.
        default: return false
        }
        return enqueue(operation)
    }

    private func enqueue(_ operation: Operation) -> Bool {
        // Collapse consecutive slider updates behind the in-flight operation. Retain
        // ordering across mute, topology and calibration changes.
        if queue.count > 1, case .volume(let ids, _, let raw) = operation,
           case .volume(let lastIDs, _, let lastRaw) = queue.last, ids == lastIDs, raw == lastRaw {
            PanelCommandLog.shared.record(control: "sonos.volume.coalesced", error: "cancelled")
            queue[queue.count - 1] = operation
        } else {
            queue.append(operation)
        }
        revision += 1
        render()
        beginMutationsIfNeeded()
        return true
    }

    private func beginMutationsIfNeeded() {
        guard mutationTask == nil else { return }
        let generation = lifecycle
        mutationTask = Task { [weak self, api] in
            while !Task.isCancelled, let operation = self?.queue.first {
                do {
                    // Resolve IDs and baselines at execution time, after earlier commands
                    // have refreshed topology/calibration. Never retry a mutation.
                    guard let details = self?.roomDetails else { return }
                    try await operation.perform(api, details: details)
                    try Task.checkCancellation()
                    guard self?.lifecycle == generation else { return }
                    if case .clearCalibration = operation { self?.globalLock = false; self?.persistLocks() }
                    // Sonos writes return void, not state. Only a fresh query confirms it.
                    let state = try await api.soundSystem()
                    guard !Task.isCancelled, let self, self.lifecycle == generation else { return }
                    self.queue.removeFirst()
                    self.accept(state)
                    self.availability = .live
                    if self.queue.isEmpty { self.mutationTask = nil }
                } catch {
                    guard !Task.isCancelled, let self, self.lifecycle == generation else { return }
                    // Also covers local topology/position failures before any HTTP call.
                    PanelCommandLog.shared.record(control: "sonos.command", error: "request failed")
                    for _ in self.queue.dropFirst() { PanelCommandLog.shared.record(control: "sonos.queued", error: "dropped: action unavailable") }
                    self.queue.removeAll()
                    self.mutationTask = nil
                    self.render()
                    self.availability = .unavailable(Self.failureMessage(error))
                    return
                }
            }
        }
    }

    private func availableRoom(_ id: String) -> SonosRoom? {
        guard let room = roomDetails[id], room.availability == .available else { return nil }
        return room
    }

    private func accept(_ state: SonosSoundSystem) {
        // Avoid a Dictionary(uniqueKeysWithValues:) trap on a malformed duplicate ID.
        roomDetails = Dictionary(state.rooms.map { ($0.uuid, $0) }, uniquingKeysWith: { first, _ in first })
        diagnostics = state.diagnostics
        var seen: Set<String> = []
        confirmedRooms = state.rooms.filter { seen.insert($0.uuid).inserted }.map { room in
            let leader = roomDetails[room.coordinatorUuid]
            let sample = leader?.availability == .available ? leader?.playbackPosition : nil
            return SoundRoom(metadata: .init(id: room.uuid, title: leader?.trackTitle, artist: leader?.trackArtist,
                                             coordinatorName: leader?.name),
                      name: room.name, rawVolume: Int(room.volume.rounded()),
                      baseline: room.baseline.map { Int($0.rounded()) }, muted: room.muted,
                      coordinator: room.coordinatorUuid, playing: leader?.transportState == "PLAYING",
                      positionSeconds: sample?.position ?? 0, durationSeconds: sample?.duration ?? 0,
                      positionUpdatedAt: sample?.updatedAt ?? .distantPast,
                      sourceKind: SoundSource(rawValue: leader?.sourceKind.rawValue ?? "idle") ?? .other,
                      sourceLabel: leader?.sourceLabel, albumArtUri: leader?.albumArtUri)
        }
        render()
    }

    private func render() {
        rooms = confirmedRooms
        pending = []
        for operation in queue {
            pending.formUnion(operation.affectedIDs(details: roomDetails))
            pending.insert("sound")
            switch operation {
            case .volume(let ids, let value, let raw):
                for index in rooms.indices where ids.contains(rooms[index].id) {
                    rooms[index].rawVolume = raw ? value : roomDetails[rooms[index].id]?.rawVolume(forDisplay: value) ?? value
                }
            case .mute(let id, let value):
                if let index = rooms.firstIndex(where: { $0.id == id }) { rooms[index].muted = value }
            default: break // Topology/transport are only shown when reported by the backend.
            }
        }
    }

    private static func failureMessage(_ error: any Error) -> String {
        panelFailureReason(error, fallback: "Sonos is unavailable. Try again.")
    }

    private enum Operation {
        case volume([String], Int, raw: Bool), mute(String, Bool)
        case transport(String, SonosTransportCommand), join(String, String), joinAll(String), leave(String)
        case seek(String, Double), source(String, SourceAction)
        case calibrate, clearCalibration

        func affectedIDs(details: [String: SonosRoom]) -> Set<String> {
            switch self {
            case .volume(let ids, _, _): Set(ids)
            case .mute(let id, _), .leave(let id): [id]
            case .transport(let id, _), .seek(let id, _):
                Set(details.values.filter { $0.coordinatorUuid == details[id]?.coordinatorUuid }.map(\.uuid))
            case .join, .joinAll, .source, .calibrate, .clearCalibration: Set(details.keys)
            }
        }

        func perform(_ api: SonosAPI, details: [String: SonosRoom]) async throws {
            func room(_ id: String) throws -> SonosRoom {
                guard let room = details[id], room.availability == .available else {
                    throw PanelAPIError.server(code: "SERVICE_UNAVAILABLE", message: "Room unavailable.", httpStatus: 503)
                }
                return room
            }
            switch self {
            case .volume(let ids, let value, let raw):
                for id in ids {
                    try Task.checkCancellation()
                    let target = try room(id)
                    try await api.setVolume(deviceIp: target.deviceIp, volume: raw ? value : target.rawVolume(forDisplay: value))
                }
            case .mute(let id, let muted):
                try await api.setMute(deviceIp: room(id).deviceIp, muted: muted)
            case .transport(let id, let command):
                let coordinator = try room(room(id).coordinatorUuid)
                try await api.transport(coordinatorIp: coordinator.deviceIp, command: command)
            case .join(let id, let target):
                let member = try room(id)
                let leader = try room(room(target).coordinatorUuid)
                guard member.coordinatorUuid != leader.uuid else {
                    PanelCommandLog.shared.record(control: "sonos.join.alreadyGrouped"); return
                }
                try await api.join(memberIp: member.deviceIp, coordinatorUuid: leader.uuid)
            case .joinAll(let target):
                let leader = try room(room(target).coordinatorUuid)
                let members = details.values.filter {
                    $0.availability == .available && $0.coordinatorUuid != leader.uuid
                }.map(\.deviceIp).sorted()
                guard !members.isEmpty else {
                    PanelCommandLog.shared.record(control: "sonos.joinAll.alreadyGrouped"); return
                }
                try await api.joinAll(coordinatorEntityId: leader.uuid, memberEntityIds: members)
            case .leave(let id):
                let member = try room(id)
                try await api.leave(memberIp: member.deviceIp, memberUuid: member.uuid)
            case .seek(let id, let seconds):
                let leader = try room(room(id).coordinatorUuid)
                guard let sample = leader.playbackPosition else {
                    throw PanelAPIError.server(code: "SERVICE_UNAVAILABLE", message: "Position unavailable.", httpStatus: 503)
                }
                try await api.seek(room: leader.uuid, positionSeconds: min(sample.duration, seconds))
            case .source(let id, let action):
                let target = try room(id)
                switch action {
                case .lineIn: try await api.setLineIn(deviceIp: target.deviceIp, sourceUuid: target.uuid)
                case .tv: try await api.grabTV(beamIp: target.deviceIp, beamUuid: target.uuid)
                case .joinAllToTV:
                    // Switching a follower to TV makes it the leader; rejoin its old group too.
                    let members = details.values.filter {
                        $0.availability == .available && $0.uuid != target.uuid &&
                        (!target.isCoordinator || $0.coordinatorUuid != target.uuid)
                    }.map(\.deviceIp).sorted()
                    try await api.joinAllToTV(tvEntityId: target.deviceIp, memberEntityIds: members)
                }
            case .calibrate: _ = try await api.calibrate()
            case .clearCalibration: try await api.clearCalibration()
            }
        }
    }
}

/// Preview/default adapter delegates to the existing fixture implementation. It
/// never constructs PanelKit or falls back to live networking.
@MainActor @Observable final class MockSonosProvider: SonosProvider {
    private let source: MockHomeDataSource
    var rooms: [SoundRoom] { source.rooms }
    var availability: LiveAvailability { .live }
    var pending: Set<String> { source.pending }
    var globalLock: Bool { source.globalLock }
    var groupLock: Bool { source.groupLock }
    let supportsPlaybackPosition = true

    init(source: MockHomeDataSource = MockHomeDataSource()) { self.source = source }
    func refresh() async {}
    @discardableResult func send(_ command: HomeCommand) -> Bool {
        switch command {
        case .transport, .seek, .rawVolume, .volume, .mute, .globalLock, .groupLock,
             .calibrate, .clearCalibration, .joinAll, .join, .leave, .playMedia:
            source.send(command)
            return true
        default: return false
        }
    }
}
