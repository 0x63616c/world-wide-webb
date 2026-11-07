import FoldingDomain
import Foundation

public struct CompetitionUpload: Codable, Sendable {
  public let operationID: UUID
  public let epochID: UUID
  public let generation: ResetGeneration
  public let isReset: Bool
  public let body: Data
  public let eventIDs: [UUID]
  let workIDs: [UUID]
  var leaseToken: UUID
  var leaseUntilMS: Int64
  var nextAttemptMS: Int64
  public var attempts: Int? = nil
}
