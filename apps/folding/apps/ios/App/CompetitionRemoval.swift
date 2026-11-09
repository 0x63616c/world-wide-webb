import Foundation

// swift-format-ignore: AlwaysUseLowerCamelCase
struct CompetitionDeletionReceipt: Codable, Sendable {
  let status: CompetitionOperation
  let polling_token: String
  let polling_token_expires_at_ms: Int64
}
struct CompetitionRemovalOperation: Codable, Sendable {
  enum Kind: String, Codable, Sendable { case delete }
  let kind: Kind
  let operationID: String
  var accepted: Bool
  var deletionReceipt: CompetitionDeletionReceipt?
}

extension CompetitionAPI {
  func deletion(operationID: String, reauthenticationToken: String) async throws
    -> CompetitionDeletionReceipt
  {
    try await transport.send(
      "POST", path: "/v1/account/delete",
      body: CompetitionTransport.encode([
        "operation_id": operationID, "reauthentication_token": reauthenticationToken,
      ]))
  }
}
