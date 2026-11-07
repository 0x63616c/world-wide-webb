import FoldingDomain
import Foundation

struct CompetitionWireEnrollment: Decodable, Sendable {
  // swift-format-ignore: AlwaysUseLowerCamelCase
  let epoch_id: String
  // swift-format-ignore: AlwaysUseLowerCamelCase
  let device_id: String
  let generation: ResetGeneration
  // swift-format-ignore: AlwaysUseLowerCamelCase
  let joined_at_ms: Int64
  // swift-format-ignore: AlwaysUseLowerCamelCase
  let issued_at_ms: Int64
}
struct CompetitionMe: Decodable, Sendable {
  let preferences: CompetitionResultPreferences?
  let profile: CompetitionWireProfile
  let enrollment: CompetitionWireEnrollment?
}
struct CompetitionJoinResponse: Decodable, Sendable {
  let profile: CompetitionWireProfile
  let enrollment: CompetitionWireEnrollment
}
struct CompetitionWireRank: Decodable, Sendable {
  // swift-format-ignore: AlwaysUseLowerCamelCase
  let participant_id: String
  let nickname: String
  // swift-format-ignore: AlwaysUseLowerCamelCase
  let avatar_id: String?
  let folds: Int
  let rank: Int
  let percentile: Int?
  let medal: String?
}
struct CompetitionWirePage<Item: Decodable & Sendable>: Decodable, Sendable {
  let items: [Item]
  // swift-format-ignore: AlwaysUseLowerCamelCase
  let next_cursor: String?
  // swift-format-ignore: AlwaysUseLowerCamelCase
  let snapshot_version: String
}
struct CompetitionBoard: Decodable, Sendable {
  struct Period: Decodable, Sendable {
    let id: String
    let kind: String
    let state: String
  }
  let period: Period
  let page: CompetitionWirePage<CompetitionWireRank>
  let you: CompetitionWireRank?
  let population: Int
}
struct CompetitionOperation: Codable, Sendable {
  // swift-format-ignore: AlwaysUseLowerCamelCase
  let operation_id: String
  let state: String
}

actor CompetitionAPI {
  let transport: CompetitionTransport
  let deviceID: UUID
  init(transport: CompetitionTransport, deviceID: UUID) {
    self.transport = transport
    self.deviceID = deviceID
  }
  func me() async throws -> CompetitionMe { try await transport.send("GET", path: "/v1/me") }
  func join(nickname: String, generation: ResetGeneration) async throws -> CompetitionJoinResponse {
    struct Request: Encodable {
      // swift-format-ignore: AlwaysUseLowerCamelCase
      let operation_id: String
      // swift-format-ignore: AlwaysUseLowerCamelCase
      let device_id: String
      let generation: ResetGeneration
      let nickname: String
    }
    return try await transport.protected(
      "POST", path: "/v1/enrollment/join", purpose: "join",
      body: CompetitionTransport.encode(
        Request(
          operation_id: UUID().uuidString.lowercased(),
          device_id: deviceID.uuidString.lowercased(), generation: generation, nickname: nickname)))
  }
  func leaderboard(kind: String, cursor: String? = nil) async throws -> CompetitionBoard {
    guard ["week", "month", "all"].contains(kind) else {
      throw CompetitionTransportError.invalidResponse
    }
    var query = URLComponents()
    query.queryItems = [
      URLQueryItem(name: "kind", value: kind), URLQueryItem(name: "limit", value: "50"),
    ]
    if let cursor { query.queryItems?.append(URLQueryItem(name: "cursor", value: cursor)) }
    return try await transport.send(
      "GET", path: "/v1/leaderboards?" + (query.percentEncodedQuery ?? ""))
  }
  func nickname(_ value: String) async throws -> CompetitionWireProfile {
    struct Response: Decodable, Sendable { let profile: CompetitionWireProfile }
    let result: Response = try await transport.send(
      "PATCH", path: "/v1/profile",
      body: CompetitionTransport.encode([
        "operation_id": UUID().uuidString.lowercased(), "nickname": value,
      ]))
    return result.profile
  }
  func leave(operationID: String) async throws -> CompetitionOperation {
    try await transport.send(
      "POST", path: "/v1/enrollment/leave",
      body: CompetitionTransport.encode(["operation_id": operationID]))
  }
  func blocks(cursor: String?) async throws -> HiddenParticipantsPage {
    struct Item: Decodable, Sendable {
      let participantID: String
      enum CodingKeys: String, CodingKey { case participantID = "participant_id" }
    }
    var query = URLComponents()
    query.queryItems = [URLQueryItem(name: "limit", value: "50")]
    if let cursor { query.queryItems?.append(URLQueryItem(name: "cursor", value: cursor)) }
    let page: CompetitionWirePage<Item>
    do {
      page = try await transport.send(
        "GET", path: "/v1/blocks?" + (query.percentEncodedQuery ?? ""))
    } catch let failure as CompetitionTransportError
      where failure.statusCode == 409 && cursor != nil
    {
      throw LeaderboardPageError.snapshotChanged
    }
    guard page.items.allSatisfy({ UUID(uuidString: $0.participantID) != nil }) else {
      throw CompetitionTransportError.invalidResponse
    }
    return HiddenParticipantsPage(
      participantIDs: page.items.map(\.participantID), nextCursor: page.next_cursor,
      snapshotVersion: page.snapshot_version)
  }

  func setBlocked(_ id: String, blocked: Bool) async throws {
    guard UUID(uuidString: id) != nil else { throw CompetitionTransportError.invalidResponse }
    struct Response: Decodable, Sendable { let blocked: Bool }
    let _: Response = try await transport.send(
      blocked ? "PUT" : "DELETE", path: "/v1/blocks/\(id)",
      body: CompetitionTransport.encode(["operation_id": UUID().uuidString.lowercased()]))
  }
}

// swift-format-ignore: AlwaysUseLowerCamelCase
struct CompetitionWireResult: Decodable, Sendable {
  let period_id: String
  let kind: String
  let start_ms: Int64
  let end_ms: Int64
  let version: Int
  let finalized_at_ms: Int64
  let folds: Int
  let rank: Int
  let population: Int
  let percentile: Int?
  let medal: String?
}
struct CompetitionWireShare: Decodable, Sendable {
  // swift-format-ignore: AlwaysUseLowerCamelCase
  struct Profile: Decodable, Sendable {
    let nickname: String
    let avatar_id: String?
  }
  let result: CompetitionWireResult
  let profile: Profile
}

extension CompetitionAPI {
  func results(kind: String, cursor: String?) async throws -> CompetitionWirePage<
    CompetitionWireResult
  > {
    guard ["week", "month"].contains(kind) else { throw CompetitionTransportError.invalidResponse }
    var query = URLComponents()
    query.queryItems = [
      URLQueryItem(name: "kind", value: kind), URLQueryItem(name: "limit", value: "30"),
    ]
    if let cursor { query.queryItems?.append(URLQueryItem(name: "cursor", value: cursor)) }
    return try await transport.send("GET", path: "/v1/results?" + (query.percentEncodedQuery ?? ""))
  }
  func share(periodID: String) async throws -> CompetitionWireShare {
    guard !periodID.isEmpty, periodID.count < 128,
      periodID.unicodeScalars.allSatisfy({
        CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_:")).contains($0)
      })
    else { throw CompetitionTransportError.invalidResponse }
    return try await transport.send("GET", path: "/v1/results/\(periodID)/share")
  }
  func report(participantID: String, reason: String) async throws {
    guard UUID(uuidString: participantID) != nil,
      ["abusive_name", "abusive_avatar", "suspected_cheating", "other"].contains(reason)
    else { throw CompetitionTransportError.invalidResponse }
    struct Report: Encodable {
      let operationID: String
      let participantID: String
      let reason: String
      func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Keys.self)
        try container.encode(operationID, forKey: .operationID)
        try container.encode(participantID, forKey: .participantID)
        try container.encode(reason, forKey: .reason)
        try container.encodeNil(forKey: .contentID)
        try container.encodeNil(forKey: .comment)
      }
      enum Keys: String, CodingKey {
        case operationID = "operation_id"
        case participantID = "subject_participant_id"
        case reason
        case contentID = "content_id"
        case comment
      }
    }
    struct Response: Decodable, Sendable { let state: String }
    let _: Response = try await transport.send(
      "POST", path: "/v1/reports",
      body: CompetitionTransport.encode(
        Report(
          operationID: UUID().uuidString.lowercased(),
          participantID: participantID, reason: reason)))
  }
}
