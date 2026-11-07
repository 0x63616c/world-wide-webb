import FoldingDomain
import Foundation

public enum MirrorRecord: Codable, Sendable, Equatable {
  case event(TrackingEvent)
  case reset(ResetGeneration, createdAtMS: Int64)
  case interruption(TrackingInterruption)
}

public struct MirrorLease: Sendable, Equatable {
  public let workID: UUID
  public let token: UUID
  public let record: MirrorRecord
}
