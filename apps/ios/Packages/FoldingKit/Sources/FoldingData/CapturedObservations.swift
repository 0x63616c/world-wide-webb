import FoldingDomain
import Foundation

/// A committed local observation, awaiting canonical event/outbox processing.
/// This is a capture acknowledgement, not a claim of a public score or completed sync.
public struct CaptureReceipt: Sendable, Equatable {
  public let eventID: UUID
  public let wasRetry: Bool
  public let cancelledNotificationIdentifier: String?
}

public struct CaptureLease: Sendable {
  public let event: TrackingEvent
  let token: UUID
}

public struct CaptureRetryStatus: Sendable, Equatable {
  public let pending: Int
  public let quarantined: Int
}

public enum CaptureError: Error, Equatable, Sendable {
  case invalidLease
}
