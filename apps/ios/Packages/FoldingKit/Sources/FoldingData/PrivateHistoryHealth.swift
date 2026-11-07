import Foundation

/// Diagnostic state, not user-facing copy. Historical conflict tombstones remain after recovery.
public struct PrivateHistoryHealth: Equatable, Sendable {
  public let conflictingResetCount: Int
  public let highestKnownResetRevision: Int64
  public let requiresAttention: Bool
  public let canResetHistory: Bool

  public init(
    conflictingResetCount: Int, highestKnownResetRevision: Int64,
    requiresAttention: Bool, canResetHistory: Bool
  ) {
    self.conflictingResetCount = conflictingResetCount
    self.highestKnownResetRevision = highestKnownResetRevision
    self.requiresAttention = requiresAttention
    self.canResetHistory = canResetHistory
  }
}
