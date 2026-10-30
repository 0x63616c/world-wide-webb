import Foundation

public enum WalkSource: String, Codable, Sendable, CaseIterable {
    case iphone, ipad, web, unknown
}

/// The WWW-27 wire record. Dates are decoded here because PanelAPIClient uses plain JSON.
public struct WalkRecord: Decodable, Sendable, Equatable {
    public let id: String
    public let startedAt: Date
    public let endedAt: Date?
    public let source: WalkSource
    public let createdAt: Date
    public let updatedAt: Date

    private enum CodingKeys: String, CodingKey { case id, startedAt, endedAt, source, createdAt, updatedAt }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        startedAt = try values.decode(WalkDate.self, forKey: .startedAt).value
        endedAt = try values.decodeIfPresent(WalkDate.self, forKey: .endedAt)?.value
        source = try values.decode(WalkSource.self, forKey: .source)
        createdAt = try values.decode(WalkDate.self, forKey: .createdAt).value
        updatedAt = try values.decode(WalkDate.self, forKey: .updatedAt).value
    }
}

public struct WalksState: Decodable, Sendable, Equatable {
    public let active: WalkRecord?
    public let updatedAt: Date
    public let serverTime: Date

    private enum CodingKeys: String, CodingKey { case active, updatedAt, serverTime }

    public init(from decoder: any Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        active = try values.decodeIfPresent(WalkRecord.self, forKey: .active)
        updatedAt = try values.decode(WalkDate.self, forKey: .updatedAt).value
        serverTime = try values.decode(WalkDate.self, forKey: .serverTime).value
    }
}

public struct WalksHistory: Decodable, Sendable, Equatable {
    public let walks: [WalkRecord]
}

public struct WalksAPI: Sendable {
    private let client: PanelAPIClient
    public init(client: PanelAPIClient) { self.client = client }

    public func state() async throws -> WalksState {
        try await client.query("walks.state", as: WalksState.self)
    }

    public func history(limit: Int? = nil, before: Date? = nil) async throws -> WalksHistory {
        if let limit, !(1...500).contains(limit) { throw invalidInput("History limit must be 1–500.") }
        struct Input: Encodable, Sendable { let limit: Int?; let before: String? }
        return try await client.query("walks.history", input: Input(limit: limit, before: before.map(WalkDate.string)),
                                      as: WalksHistory.self)
    }

    /// Omit startedAt for a live start: the server supplies the authoritative time.
    public func start(id: UUID? = nil, startedAt: Date? = nil, source: WalkSource = .unknown) async throws -> WalksState {
        struct Input: Encodable, Sendable { let id: String?; let startedAt: String?; let source: WalkSource }
        return try await client.mutation("walks.start", input: Input(id: id?.uuidString.lowercased(),
            startedAt: startedAt.map(WalkDate.string), source: source), as: WalksState.self)
    }

    public func stop(id: String, endedAt: Date? = nil) async throws -> WalksState {
        try validateID(id)
        struct Input: Encodable, Sendable { let id: String; let endedAt: String? }
        return try await client.mutation("walks.stop", input: Input(id: id, endedAt: endedAt.map(WalkDate.string)),
                                         as: WalksState.self)
    }

    public func delete(id: String) async throws -> WalksState {
        try validateID(id)
        return try await client.mutation("walks.delete", input: ["id": id], as: WalksState.self)
    }

    public func update(id: String, startedAt: Date? = nil, endedAt: Date? = nil) async throws -> WalksState {
        try validateID(id)
        if let startedAt, let endedAt, endedAt < startedAt { throw invalidInput("End must be at or after start.") }
        struct Input: Encodable, Sendable { let id: String; let startedAt: String?; let endedAt: String? }
        return try await client.mutation("walks.update", input: Input(id: id,
            startedAt: startedAt.map(WalkDate.string), endedAt: endedAt.map(WalkDate.string)), as: WalksState.self)
    }

    private func validateID(_ id: String) throws {
        guard (1...128).contains(id.utf16.count) else { throw invalidInput("Walk ID must contain 1–128 characters.") }
    }

    private func invalidInput(_ message: String) -> PanelAPIError {
        .server(code: "BAD_REQUEST", message: message, httpStatus: 400)
    }
}

private struct WalkDate: Decodable {
    let value: Date

    init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()
        let string = try container.decode(String.self)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: string) { value = date; return }
        formatter.formatOptions = [.withInternetDateTime]
        guard let date = formatter.date(from: string) else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Expected an ISO-8601 timestamp.")
        }
        value = date
    }

    static func string(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}
