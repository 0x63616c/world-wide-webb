import Foundation

#if canImport(FoundationNetworking)
    import FoundationNetworking
#endif

public enum SonosSource: String, Decodable, Sendable {
    case lineIn = "line-in"
    case tv, spotify, airplay, other, idle
}

public enum SonosAvailability: String, Decodable, Sendable {
    case available, unavailable, unknown
}

public enum SonosTransportCommand: String, Encodable, Sendable, CaseIterable {
    case play, pause, next, previous
}

/// Mirrors features/sound/api.ts. Legacy UUID/IP fields currently contain HA entity IDs.
public struct SonosRoom: Decodable, Sendable, Equatable, Identifiable {
    public var id: String { uuid }
    public let name: String
    public let uuid: String
    public let deviceIp: String
    public let coordinatorUuid: String
    public let memberUuids: [String]
    public let isCoordinator: Bool
    public let volume: Double
    public let baseline: Double?
    public let muted: Bool
    public let transportState: String
    public let sourceLabel: String?
    public let sourceKind: SonosSource
    public let trackTitle: String?
    public let trackArtist: String?
    public let albumArtUri: String?
    public let availability: SonosAvailability
    public let groupStatus: String
    // WWW-42: all are optional so old servers still decode without invented progress.
    public let position: Double?
    public let duration: Double?
    public let positionAt: String?

    public var playbackPosition: SonosPlaybackPosition? {
        guard availability == .available, sourceKind != .tv, sourceKind != .lineIn,
            transportState == "PLAYING" || transportState == "PAUSED_PLAYBACK",
            let position, position.isFinite, position >= 0,
            let duration, duration.isFinite, duration > 0, let positionAt
        else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = fractional.date(from: positionAt) ?? ISO8601DateFormatter().date(from: positionAt) else {
            return nil
        }
        return SonosPlaybackPosition(position: min(position, duration), duration: duration, updatedAt: date)
    }

    /// Like features/sound/calibration.ts: display can exceed 100; raw writes cannot.
    public var displayVolume: Double {
        guard let baseline, baseline > 0 else { return volume }
        return (volume / baseline * 100).rounded()
    }

    public func rawVolume(forDisplay percent: Int) -> Int {
        let scale = baseline.flatMap { $0 > 0 ? $0 / 100 : nil } ?? 1
        let value = Double(percent) * scale
        return Int(min(100, max(0, value)).rounded())
    }
}

public struct SonosPlaybackPosition: Sendable, Equatable {
    public let position: Double
    public let duration: Double
    public let updatedAt: Date
}

public struct SonosSoundSystem: Decodable, Sendable, Equatable {
    public struct Diagnostics: Decodable, Sendable, Equatable {
        public let controlPlane: String
        public let queriedAt: String
        public let message: String
    }
    public let rooms: [SonosRoom]
    public let diagnostics: Diagnostics
}

public struct SonosAPI: Sendable {
    private let client: PanelAPIClient
    public init(configuration: PanelConfiguration?, transport: any PanelTransport = PanelAPIClient.defaultTransport) {
        client = PanelAPIClient(configuration: configuration, transport: transport)
    }
    public func soundSystem() async throws -> SonosSoundSystem {
        try await client.get("sound", as: SonosSoundSystem.self)
    }
    /// Reads topology immediately before acting; never sends a write to excluded rooms.
    public func groupLineIn(sourceID: String, excluding excluded: Set<String>) async throws {
        let state = try await soundSystem()
        guard !excluded.contains(sourceID),
            let source = state.rooms.first(where: { $0.uuid == sourceID && $0.availability == .available })
        else {
            throw Self.invalid("Line-in speaker unavailable.")
        }
        // Switching a coordinator's input would also switch any protected follower.
        guard !state.rooms.contains(where: { excluded.contains($0.uuid) && $0.coordinatorUuid == sourceID }) else {
            throw Self.invalid("The TV is grouped with Desk. Separate it before changing the line-in group.")
        }
        if source.coordinatorUuid != sourceID {
            try await leave(memberIp: source.deviceIp, memberUuid: source.uuid)
        }
        try await setLineIn(deviceIp: source.deviceIp, sourceUuid: source.uuid)
        let members = state.rooms.filter {
            $0.availability == .available && $0.uuid != sourceID && !excluded.contains($0.uuid)
        }.map(\.deviceIp).sorted()
        if !members.isEmpty { try await joinAll(coordinatorEntityId: source.uuid, memberEntityIds: members) }
    }

    public func setVolume(deviceIp: String, volume: Int) async throws {
        guard (0...100).contains(volume) else { throw Self.invalid("Volume must be 0–100.") }
        try await write(Command(action: "volume", room: deviceIp, volume: volume))
    }
    public func setMute(deviceIp: String, muted: Bool) async throws {
        try await write(Command(action: "mute", room: deviceIp, muted: muted))
    }
    public func transport(coordinatorIp: String, command: SonosTransportCommand) async throws {
        try await write(Command(action: "transport", room: coordinatorIp, command: command))
    }
    public func join(memberIp: String, coordinatorUuid: String) async throws {
        try await joinAll(coordinatorEntityId: coordinatorUuid, memberEntityIds: [memberIp])
    }
    public func joinAll(coordinatorEntityId: String, memberEntityIds: [String]) async throws {
        try await write(Command(action: "join", coordinator: coordinatorEntityId, members: memberEntityIds))
    }
    public func leave(memberIp: String, memberUuid: String) async throws {
        guard !memberUuid.isEmpty else { throw Self.invalid("A member is required.") }
        try await write(Command(action: "leave", room: memberIp))
    }
    public func seek(room: String, positionSeconds: Double) async throws {
        guard positionSeconds.isFinite, positionSeconds >= 0 else { throw Self.invalid("Invalid seek position.") }
        try await write(Command(action: "seek", room: room, positionSeconds: positionSeconds))
    }
    public func setLineIn(deviceIp: String, sourceUuid: String) async throws {
        try await write(Command(action: "source", room: deviceIp, source: "Line-in"))
    }
    public func grabTV(beamIp: String, beamUuid: String) async throws {
        try await write(Command(action: "source", room: beamIp, source: "TV"))
    }
    public func joinAllToTV(tvEntityId: String, memberEntityIds: [String]) async throws {
        try await write(Command(action: "tv", room: tvEntityId, members: memberEntityIds))
    }
    public func calibrate() async throws -> [String: Double] {
        try await client.post("sound/calibration", input: [String: String](), as: [String: Double].self)
    }
    public func clearCalibration() async throws {
        _ = try await client.delete("sound/calibration", as: Acknowledgement.self)
    }
    private func write(_ command: Command) async throws {
        func valid(_ id: String) -> Bool {
            id.range(of: "^media_player\\.[a-z0-9_]+$", options: .regularExpression) != nil
        }
        if let room = command.room, !valid(room) { throw Self.invalid("Invalid room.") }
        if let coordinator = command.coordinator, !valid(coordinator) { throw Self.invalid("Invalid coordinator.") }
        if let members = command.members {
            guard members.allSatisfy(valid), Set(members).count == members.count,
                !members.contains(command.coordinator ?? command.room ?? "")
            else { throw Self.invalid("Invalid group members.") }
            if command.action == "join" && members.isEmpty { throw Self.invalid("Members are required.") }
        }

        _ = try await client.post("sound", input: command, as: Acknowledgement.self)
    }
    private struct Command: Encodable, Sendable {
        let action: String
        var room: String? = nil
        var volume: Int? = nil
        var muted: Bool? = nil
        var command: SonosTransportCommand? = nil
        var positionSeconds: Double? = nil
        var coordinator: String? = nil
        var members: [String]? = nil
        var source: String? = nil
    }
    private struct Acknowledgement: Decodable, Sendable {
        init(from decoder: any Decoder) throws {
            let value = try decoder.singleValueContainer()
            guard value.decodeNil() else {
                throw DecodingError.dataCorruptedError(
                    in: value, debugDescription: "Expected an empty acknowledgement.")
            }
        }
    }
    private static func invalid(_ message: String) -> PanelAPIError {
        .server(code: "BAD_REQUEST", message: message, httpStatus: 400)
    }
}
