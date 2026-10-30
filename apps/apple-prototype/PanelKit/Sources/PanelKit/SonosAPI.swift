import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public enum SonosSource: String, Decodable, Sendable {
    case lineIn = "line-in", tv, spotify, airplay, other, idle
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
              let duration, duration.isFinite, duration > 0, let positionAt else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = fractional.date(from: positionAt) ?? ISO8601DateFormatter().date(from: positionAt) else { return nil }
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

    /// Shares PanelKit authentication, error handling and request encoding. The transport
    /// adapter only supplies null for tRPC's omitted `data` on void Sonos mutations.
    public init(configuration: PanelConfiguration?, transport: any PanelTransport = URLSession.shared) {
        client = PanelAPIClient(configuration: configuration, transport: SonosVoidTransport(base: transport))
    }

    public func soundSystem() async throws -> SonosSoundSystem {
        try await client.query("sound.soundSystem", as: SonosSoundSystem.self)
    }

    public func setVolume(deviceIp: String, volume: Int) async throws {
        guard (0...100).contains(volume) else { throw Self.invalid("Volume must be 0–100.") }
        struct Input: Encodable, Sendable { let deviceIp: String; let volume: Int }
        try await write("sonosSetVolume", Input(deviceIp: deviceIp, volume: volume))
    }

    public func setMute(deviceIp: String, muted: Bool) async throws {
        struct Input: Encodable, Sendable { let deviceIp: String; let muted: Bool }
        try await write("sonosSetMute", Input(deviceIp: deviceIp, muted: muted))
    }

    public func transport(coordinatorIp: String, command: SonosTransportCommand) async throws {
        struct Input: Encodable, Sendable { let coordinatorIp: String; let command: SonosTransportCommand }
        try await write("sonosTransport", Input(coordinatorIp: coordinatorIp, command: command))
    }

    public func join(memberIp: String, coordinatorUuid: String) async throws {
        guard !coordinatorUuid.isEmpty else { throw Self.invalid("A coordinator is required.") }
        struct Input: Encodable, Sendable { let memberIp: String; let coordinatorUuid: String }
        try await write("sonosGroupJoin", Input(memberIp: memberIp, coordinatorUuid: coordinatorUuid))
    }

    public func joinAll(coordinatorEntityId: String, memberEntityIds: [String]) async throws {
        guard coordinatorEntityId.hasPrefix("media_player."), !memberEntityIds.isEmpty,
              memberEntityIds.allSatisfy({ $0.hasPrefix("media_player.") }) else {
            throw Self.invalid("Join all requires a coordinator and members with media_player entity IDs.")
        }
        struct Input: Encodable, Sendable { let coordinatorEntityId: String; let memberEntityIds: [String] }
        try await write("sonosGroupJoinAll", Input(coordinatorEntityId: coordinatorEntityId, memberEntityIds: memberEntityIds))
    }

    public func leave(memberIp: String, memberUuid: String) async throws {
        guard !memberUuid.isEmpty else { throw Self.invalid("A member is required.") }
        struct Input: Encodable, Sendable { let memberIp: String; let memberUuid: String }
        try await write("sonosGroupLeave", Input(memberIp: memberIp, memberUuid: memberUuid))
    }

    public func seek(room: String, positionSeconds: Double) async throws {
        guard room.range(of: "^media_player\\.[a-z0-9_]+$", options: .regularExpression) != nil,
              positionSeconds.isFinite, positionSeconds >= 0 else { throw Self.invalid("Invalid seek target.") }
        struct Input: Encodable, Sendable { let room: String; let positionSeconds: Double }
        try await write("sonosSeek", Input(room: room, positionSeconds: positionSeconds))
    }

    public func setLineIn(deviceIp: String, sourceUuid: String) async throws {
        guard !sourceUuid.isEmpty else { throw Self.invalid("A source is required.") }
        struct Input: Encodable, Sendable { let deviceIp: String; let sourceUuid: String }
        try await write("sonosSetLineIn", Input(deviceIp: deviceIp, sourceUuid: sourceUuid))
    }

    public func grabTV(beamIp: String, beamUuid: String) async throws {
        guard !beamUuid.isEmpty else { throw Self.invalid("A TV room is required.") }
        struct Input: Encodable, Sendable { let beamIp: String; let beamUuid: String }
        try await write("sonosGrabTvToBeam", Input(beamIp: beamIp, beamUuid: beamUuid))
    }

    public func joinAllToTV(tvEntityId: String, memberEntityIds: [String]) async throws {
        guard tvEntityId.hasPrefix("media_player."), memberEntityIds.allSatisfy({ $0.hasPrefix("media_player.") }) else {
            throw Self.invalid("TV grouping requires media_player entity IDs.")
        }
        struct Input: Encodable, Sendable { let tvEntityId: String; let memberEntityIds: [String] }
        try await write("sonosGroupJoinAllToTv", Input(tvEntityId: tvEntityId, memberEntityIds: memberEntityIds))
    }

    public func calibrate() async throws -> [String: Double] {
        try await client.mutation("sound.sonosCalibrate", input: EmptyInput(), as: [String: Double].self)
    }

    public func clearCalibration() async throws {
        try await write("sonosClearCalibration", EmptyInput())
    }

    private func write<Input: Encodable & Sendable>(_ procedure: String, _ input: Input) async throws {
        _ = try await client.mutation("sound." + procedure, input: input, as: SonosAcknowledgement.self)
    }

    private static func invalid(_ message: String) -> PanelAPIError {
        .server(code: "BAD_REQUEST", message: message, httpStatus: 400)
    }
}

private struct EmptyInput: Encodable, Sendable {}

private struct SonosAcknowledgement: Decodable, Sendable {
    init(from decoder: any Decoder) throws {
        let value = try decoder.singleValueContainer()
        guard value.decodeNil() else {
            throw DecodingError.dataCorruptedError(in: value, debugDescription: "Expected a void Sonos response.")
        }
    }
}

/// tRPC serializes an undefined mutation result as {"result":{}}. WWW-11's
/// generic envelope requires `data`. Normalize only the known void routes;
/// errors and malformed success envelopes must still fail in PanelAPIClient.
private struct SonosVoidTransport: PanelTransport {
    let base: any PanelTransport
    private static let procedures: Set<String> = [
        "sound.sonosSetVolume", "sound.sonosSetMute", "sound.sonosTransport",
        "sound.sonosGroupJoin", "sound.sonosGroupJoinAll", "sound.sonosGroupLeave",
        "sound.sonosClearCalibration", "sound.sonosSeek", "sound.sonosSetLineIn",
        "sound.sonosGrabTvToBeam", "sound.sonosGroupJoinAllToTv"
    ]

    func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        let (data, response) = try await base.send(request)
        guard request.httpMethod == "POST", Self.procedures.contains(request.url?.lastPathComponent ?? ""),
              (200..<300).contains(response.statusCode),
              var envelope = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              envelope["error"] == nil, var result = envelope["result"] as? [String: Any],
              result.isEmpty else { return (data, response) }
        result["data"] = NSNull()
        envelope["result"] = result
        return (try JSONSerialization.data(withJSONObject: envelope), response)
    }
}
