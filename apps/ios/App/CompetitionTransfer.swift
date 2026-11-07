import FoldingDomain
import Foundation

import struct FoldingData.PendingCompetitionTransfer

extension CompetitionAPI {
  func transfer(_ pending: PendingCompetitionTransfer) async throws -> CompetitionWireEnrollment {
    struct Request: Encodable {
      let operationID: UUID
      let fromEpochID: UUID
      let deviceID: UUID
      let generation: ResetGeneration
      enum CodingKeys: String, CodingKey {
        case operationID = "operation_id"
        case fromEpochID = "from_epoch_id"
        case deviceID = "device_id"
        case generation
      }
      func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(operationID.uuidString.lowercased(), forKey: .operationID)
        try values.encode(fromEpochID.uuidString.lowercased(), forKey: .fromEpochID)
        try values.encode(deviceID.uuidString.lowercased(), forKey: .deviceID)
        try values.encode(generation, forKey: .generation)
      }
    }
    struct Response: Decodable, Sendable { let enrollment: CompetitionWireEnrollment }
    let result: Response = try await transport.protected(
      "POST", path: "/v1/enrollment/transfer", purpose: "transfer",
      body: CompetitionTransport.encode(
        Request(
          operationID: pending.operationID,
          fromEpochID: pending.fromEpochID, deviceID: pending.deviceID,
          generation: pending.generation)))
    return result.enrollment
  }

  func synchronizeTransferReset(_ pending: PendingCompetitionTransfer) async throws {
    struct Request: Encodable {
      let schemaVersion = 1
      let operationID: String
      let epochID: String
      let generation: ResetGeneration
      enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case operationID = "operation_id"
        case epochID = "epoch_id"
        case generation
      }
    }
    struct Response: Decodable, Sendable {
      let generation: ResetGeneration
      let state: String
      let operationID: String
      enum CodingKeys: String, CodingKey {
        case generation, state
        case operationID = "operation_id"
      }
    }
    let response: Response = try await transport.protected(
      "POST", path: "/v1/resets", purpose: "reset",
      body: CompetitionTransport.encode(
        Request(
          operationID: pending.resetOperationID.uuidString.lowercased(),
          epochID: pending.fromEpochID.uuidString.lowercased(), generation: pending.generation)))
    guard response.operationID == pending.resetOperationID.uuidString.lowercased(),
      ["acknowledged", "superseded"].contains(response.state),
      response.generation == pending.generation
    else { throw CompetitionTransportError.unavailable }
  }
}
