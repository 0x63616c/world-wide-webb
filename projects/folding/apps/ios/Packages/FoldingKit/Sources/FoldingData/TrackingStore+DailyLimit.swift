import FoldingDomain
import Foundation

extension TrackingStore {
  public func dailyLimitPreferences() throws -> DailyLimitPreferences {
    try journalTransaction(write: false) { try dailyLimitPreferencesInTransaction() }
  }

  /// Returns the request identifier to remove from UserNotifications when pending work is cancelled.
  /// Changing settings never checks the threshold immediately; only a later real local event may claim.
  public func setDailyLimitPreferences(_ preferences: DailyLimitPreferences) throws -> String? {
    try journalTransaction { try setDailyLimitPreferencesInTransaction(preferences) }
  }

  func setDailyLimitPreferencesInTransaction(_ preferences: DailyLimitPreferences) throws
    -> String?
  {
    guard (1...1_000_000).contains(preferences.threshold) else { throw StoreError.invalidInput }
    guard preferences != (try dailyLimitPreferencesInTransaction()) else { return nil }
    let identifier = try currentDailyLimitClaim()?.notificationIdentifier
    try database.execute(
      "UPDATE daily_limit_preferences SET enabled=?,threshold=?,evaluated_device=?,evaluated_sequence=? WHERE id=1",
      [
        .integer(preferences.enabled ? 1 : 0), .integer(Int64(preferences.threshold)),
        .text(deviceID.canonical), .integer(try nextSequence() - 1),
      ])
    try cancelDailyLimitWorkInTransaction()
    return identifier
  }

  /// Evaluate only after a committed real observation. Repeated calls/retries cannot reopen a day.
  @discardableResult
  public func evaluateDailyLimit(afterEventID: UUID, homeTimezone: String, nowMS: Int64)
    async throws -> UUID?
  {
    try validateTime(nowMS)
    let range = try PersonalDateRange.trailingDays(1, throughMS: nowMS, homeTimezone: homeTimezone)
    try validateTime(range.endMS)
    for _ in 0..<3 {
      let snapshot = try await compactAnalytics(
        homeTimezone: homeTimezone, asOfMS: nowMS, range: range)
      let outcome: (matched: Bool, claim: UUID?) = try journalTransaction {
        let revision = try derivedRevision()
        guard snapshot.version.journalID == revision.journalID,
          snapshot.version.revision == revision.revision
        else { return (false, nil) }
        guard
          let payload = try database.rows(
            "SELECT payload_json FROM events WHERE event_id=? AND event_id NOT IN (SELECT entity_id FROM quarantines)",
            [.text(afterEventID.canonical)]
          ).first?["payload_json"]
        else { return (true, nil) }
        let event: TrackingEvent = try decode(payload)
        guard event.deviceID == deviceID, event.generation == snapshot.generation, !event.isTest
        else { return (true, nil) }
        let state = try database.rows(
          "SELECT evaluated_device,evaluated_sequence FROM daily_limit_preferences WHERE id=1"
        ).first!
        let baseline =
          state["evaluated_device"] == deviceID.canonical ? Int64(state["evaluated_sequence"]!)! : 0
        guard event.sequence > baseline else { return (true, nil) }
        try database.execute(
          "UPDATE daily_limit_preferences SET evaluated_device=?,evaluated_sequence=? WHERE id=1",
          [.text(deviceID.canonical), .integer(event.sequence)])
        let preferences = try dailyLimitPreferencesInTransaction()
        guard preferences.enabled,
          snapshot.selectedDeviceID == nil || snapshot.selectedDeviceID == deviceID,
          let day = snapshot.days.first, day.folds >= preferences.threshold
        else { return (true, nil) }
        if let current = try currentDailyLimitClaim(), nowMS < current.notBeforeMS {
          return (true, nil)
        }
        let claim = DailyLimitNotificationClaim(
          claimID: UUID(), createdAtMS: nowMS,
          dayStartMS: range.startMS, notBeforeMS: range.endMS, homeTimezone: homeTimezone,
          threshold: preferences.threshold, folds: day.folds)
        try database.execute(
          "INSERT INTO daily_limit_claim(id,claim_id,payload_json,state,lease_token,lease_until_ms,next_attempt_ms) VALUES (1,?,?,'pending',NULL,NULL,0) ON CONFLICT(id) DO UPDATE SET claim_id=excluded.claim_id,payload_json=excluded.payload_json,state='pending',lease_token=NULL,lease_until_ms=NULL,next_attempt_ms=0",
          [.text(claim.claimID.canonical), .text(try encode(claim))])
        return (true, claim.claimID)
      }
      if outcome.matched { return outcome.claim }
    }
    throw PersonalReadError.changedSnapshot
  }

  public func dailyLimitNotificationIdentifier() throws -> String? {
    try journalTransaction(write: false) { try currentDailyLimitClaim()?.notificationIdentifier }
  }

  public func leaseDailyLimitNotification(nowMS: Int64) throws -> DailyLimitNotificationLease? {
    try validateTime(nowMS)
    return try journalTransaction {
      guard try dailyLimitPreferencesInTransaction().enabled,
        let claim = try currentDailyLimitClaim()
      else { return nil }
      guard nowMS < claim.notBeforeMS else {
        try database.execute(
          "UPDATE daily_limit_claim SET state='expired',lease_token=NULL,lease_until_ms=NULL WHERE id=1 AND state IN ('pending','leased')"
        )
        return nil
      }
      guard
        let row = try database.rows(
          "SELECT state,lease_until_ms,next_attempt_ms FROM daily_limit_claim WHERE id=1"
        ).first,
        Int64(row["next_attempt_ms"]!)! <= nowMS,
        row["state"] == "pending"
          || (row["state"] == "leased" && Int64(row["lease_until_ms"] ?? "0")! <= nowMS)
      else { return nil }
      let token = UUID()
      let expiration = min(
        claim.notBeforeMS, nowMS + min(60000, TrackingReducer.maximumInteger - nowMS))
      try database.execute(
        "UPDATE daily_limit_claim SET state='leased',lease_token=?,lease_until_ms=? WHERE id=1",
        [.text(token.canonical), .integer(expiration)])
      return DailyLimitNotificationLease(claim: claim, token: token)
    }
  }

  /// Recheck immediately before scheduling. Root's notification coordinator reconciles this stable
  /// identifier with pending/delivered OS requests before retrying a save whose acknowledgment was lost.
  public func validateDailyLimitNotificationLease(
    _ lease: DailyLimitNotificationLease, nowMS: Int64
  ) throws {
    try validateTime(nowMS)
    try journalTransaction(write: false) {
      guard try dailyLimitPreferencesInTransaction().enabled,
        nowMS < lease.claim.notBeforeMS,
        try !database.rows(
          "SELECT claim_id FROM daily_limit_claim WHERE id=1 AND claim_id=? AND state='leased' AND lease_token=? AND lease_until_ms>?",
          [.text(lease.claim.claimID.canonical), .text(lease.token.canonical), .integer(nowMS)]
        ).isEmpty
      else { throw DailyLimitNotificationError.invalidLease }
    }
  }

  public func acknowledgeDailyLimitNotification(_ lease: DailyLimitNotificationLease) throws {
    try journalTransaction {
      try database.execute(
        "UPDATE daily_limit_claim SET state='acknowledged',lease_token=NULL,lease_until_ms=NULL WHERE id=1 AND claim_id=? AND state='leased' AND lease_token=?",
        [.text(lease.claim.claimID.canonical), .text(lease.token.canonical)])
    }
  }

  public func retryDailyLimitNotification(_ lease: DailyLimitNotificationLease, atMS: Int64) throws
  {
    try validateTime(atMS)
    try journalTransaction {
      try database.execute(
        "UPDATE daily_limit_claim SET state='pending',lease_token=NULL,lease_until_ms=NULL,next_attempt_ms=? WHERE id=1 AND claim_id=? AND state='leased' AND lease_token=?",
        [.integer(atMS), .text(lease.claim.claimID.canonical), .text(lease.token.canonical)])
    }
  }

  private func dailyLimitPreferencesInTransaction() throws -> DailyLimitPreferences {
    guard
      let row = try database.rows(
        "SELECT enabled,threshold FROM daily_limit_preferences WHERE id=1"
      ).first,
      let threshold = row["threshold"].flatMap(Int.init)
    else { throw StoreError.invalidInput }
    return DailyLimitPreferences(enabled: row["enabled"] == "1", threshold: threshold)
  }
  private func currentDailyLimitClaim() throws -> DailyLimitNotificationClaim? {
    try database.rows("SELECT payload_json FROM daily_limit_claim WHERE id=1").first.map {
      try decode($0["payload_json"]!)
    }
  }
  func cancelDailyLimitWorkInTransaction() throws {
    try database.execute(
      "UPDATE daily_limit_claim SET state='cancelled',lease_token=NULL,lease_until_ms=NULL WHERE id=1 AND state IN ('pending','leased')"
    )
  }
}
