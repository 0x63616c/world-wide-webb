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

extension MirrorRecord {
  public var logicalID: UUID {
    switch self {
    case .event(let event): event.eventID
    case .reset(let generation, _): generation.resetID
    case .interruption(let marker): marker.interruptionID
    }
  }
  public var generation: ResetGeneration {
    switch self {
    case .event(let event): event.generation
    case .reset(let generation, _): generation
    case .interruption(let marker): marker.generation
    }
  }
  var entityName: String {
    switch self {
    case .event: "ReplicatedEvent"
    case .reset: "ResetMarker"
    case .interruption: "TrackingInterruption"
    }
  }
}
