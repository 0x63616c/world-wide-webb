import FoldingDomain
import Foundation

public struct PendingCompetitionTransfer: Codable, Equatable, Sendable {
  public let operationID: UUID
  public let resetOperationID: UUID
  public let participantID: UUID
  public let deviceID: UUID
  public let fromEpochID: UUID
  public let generation: ResetGeneration
}
