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
struct CompetitionOperation: Decodable, Sendable {
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
  func leave() async throws -> CompetitionOperation {
    try await transport.send(
      "POST", path: "/v1/enrollment/leave",
      body: CompetitionTransport.encode(["operation_id": UUID().uuidString.lowercased()]))
  }
  func setBlocked(_ id: String, blocked: Bool) async throws {
    guard UUID(uuidString: id) != nil else { throw CompetitionTransportError.invalidResponse }
    struct Response: Decodable, Sendable { let blocked: Bool }
    let _: Response = try await transport.send(
      blocked ? "PUT" : "DELETE", path: "/v1/blocks/\(id)",
      body: CompetitionTransport.encode(["operation_id": UUID().uuidString.lowercased()]))
  }
}
