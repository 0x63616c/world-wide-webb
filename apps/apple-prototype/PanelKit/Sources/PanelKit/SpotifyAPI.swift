import Foundation

public struct SpotifyReference: Codable, Sendable, Equatable, Hashable {
    public let id: String
    public let type: String
    public init(id: String, type: String) { self.id = id; self.type = type }
}
public struct SpotifyItem: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let type: String
    public let title: String
    public let kind: String
    public let playable: Bool
    public let expandable: Bool
    public var reference: SpotifyReference { .init(id: id, type: type) }
}
public struct SpotifyLibrary: Decodable, Sendable, Equatable {
    public let title: String
    public let items: [SpotifyItem]
}
public struct SpotifyAccount: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
}
public struct SpotifyRoom: Decodable, Sendable, Equatable, Identifiable {
    public let id: String
    public let name: String
    public let coordinator: String
    public let available: Bool
    public let playing: Bool
    public let title: String?
    public let artist: String?
}
public struct SpotifyState: Decodable, Sendable, Equatable {
    public let configured: Bool
    public let accounts: [SpotifyAccount]
    public let rooms: [SpotifyRoom]
}
public struct SpotifyAPI: Sendable {
    private let client: PanelAPIClient
    public init(client: PanelAPIClient) { self.client = client }
    public func state() async throws -> SpotifyState { try await client.query("spotify.state", as: SpotifyState.self) }
    public func browse(source: String, reference: SpotifyReference?) async throws -> SpotifyLibrary {
        struct Input: Encodable, Sendable { let source: String; let reference: SpotifyReference? }
        return try await client.query("spotify.browse", input: Input(source: source, reference: reference), as: SpotifyLibrary.self)
    }
    public func play(room: String, reference: SpotifyReference) async throws {
        struct Input: Encodable, Sendable { let room: String; let reference: SpotifyReference }
        try await accepted("spotify.play", input: Input(room: room, reference: reference))
    }
    public func transport(room: String, command: String) async throws {
        struct Input: Encodable, Sendable { let room: String; let command: String }
        try await accepted("spotify.transport", input: Input(room: room, command: command))
    }
    private struct Ack: Decodable, Sendable { let accepted: Bool }
    private func accepted<Input: Encodable & Sendable>(_ path: String, input: Input) async throws {
        let response = try await client.mutation(path, input: input, as: Ack.self)
        guard response.accepted else { throw PanelAPIError.decoding("Playback was not accepted.") }
    }
}
