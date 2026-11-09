import FoldingDomain
import Foundation

public struct DailyLimitPreferences: Equatable, Sendable {
  public let enabled: Bool
  public let threshold: Int
  public init(enabled: Bool = false, threshold: Int = 100) {
    self.enabled = enabled
    self.threshold = threshold
  }
}

/// Private local-only claim. Its next-midnight lock survives reset and preference changes.
public struct DailyLimitNotificationClaim: Codable, Equatable, Sendable {
  public let claimID: UUID
  public let createdAtMS: Int64
  public let dayStartMS: Int64
  public let notBeforeMS: Int64
  public let homeTimezone: String
  public let threshold: Int
  public let folds: Int
  public var notificationIdentifier: String {
    "folding.daily-limit." + claimID.uuidString.lowercased()
  }
}

public struct DailyLimitNotificationLease: Sendable {
  public let claim: DailyLimitNotificationClaim
  let token: UUID
}
public enum DailyLimitNotificationError: Error, Equatable, Sendable { case invalidLease }
