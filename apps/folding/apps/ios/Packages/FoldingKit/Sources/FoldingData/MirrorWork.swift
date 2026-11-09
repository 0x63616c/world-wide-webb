import FoldingDomain
import Foundation

public enum MirrorRecord: Codable, Sendable, Equatable {
  case event(TrackingEvent)
  case deletion(TrackingDeletion)
  case reset(ResetGeneration, createdAtMS: Int64)
  case interruption(TrackingInterruption)
  case transfer(PrivateTransferMarker)
  case transferRejection(UUID)
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
    case .deletion(let marker): marker.deletionID
    case .reset(let generation, _): generation.resetID
    case .interruption(let marker): marker.interruptionID
    case .transfer(let marker): marker.transferID
    case .transferRejection(let id): id
    }
  }
  public var generation: ResetGeneration? {
    switch self {
    case .event(let event): event.generation
    case .deletion(let marker): marker.target.generation
    case .reset(let generation, _): generation
    case .interruption(let marker): marker.generation
    case .transfer, .transferRejection: nil
    }
  }
  var entityName: String {
    switch self {
    case .event: "ReplicatedEvent"
    case .reset: "ResetMarker"
    case .interruption, .deletion: "TrackingInterruption"
    case .transfer, .transferRejection: "TransferMarker"
    }
  }
}

/// Work completed by one bounded cleanup transaction; it is not a cloud deletion acknowledgment.
public struct MirrorCleanupReport: Sendable, Equatable {
  public let indexedRecords: Int
  public let deletedRecords: Int
}
