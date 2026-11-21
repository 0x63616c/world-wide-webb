import FoldingDomain
import Foundation

extension TrackingStore {
  public func record(_ observation: Observation, nowMS: Int64) throws -> RecordingReceipt {
    try validateTime(nowMS)
    return try journalTransaction {
      let receipt = try captureInTransaction(observation, nowMS: nowMS)
      _ = try materializeCaptureInTransaction(receipt.event)
      try database.execute(
        "DELETE FROM captured_observations WHERE event_id=?",
        [.text(receipt.event.eventID.canonical)])
      return receipt
    }
  }

  /// The entire capture is a single short journal transaction, independent of CloudKit,
  /// history reductions and transport. Sequence, generation, epoch and setup attribution are fixed here.
  public func capture(
    _ transition: Transition, id: UUID = UUID(), observedAtMS: Int64, timezoneID: String,
    nowMS: Int64, dailyLimitPreferences: DailyLimitPreferences? = nil
  ) throws -> CaptureReceipt {
    try validateTime(nowMS)
    return try journalTransaction {
      let cancelled: String?
      if let dailyLimitPreferences {
        cancelled = try setDailyLimitPreferencesInTransaction(dailyLimitPreferences)
      } else {
        cancelled = nil
      }
      let observation = Observation(
        id: id, generation: try generation(), transition: transition,
        observedAtMS: observedAtMS, timezoneID: timezoneID,
        competitionEpochID: try competitionEpoch())
      let receipt = try captureInTransaction(observation, nowMS: nowMS)
      return CaptureReceipt(
        eventID: receipt.event.eventID, wasRetry: receipt.wasRetry,
        cancelledNotificationIdentifier: cancelled)
    }
  }

  private func captureInTransaction(_ observation: Observation, nowMS: Int64) throws
    -> RecordingReceipt
  {
    let current = try generation()
    guard observation.generation == current else { throw StoreError.staleGeneration }
    if let row = try database.rows(
      "SELECT payload_json FROM events WHERE event_id=?", [.text(observation.id.canonical)]
    ).first {
      let existing: TrackingEvent = try decode(row["payload_json"]!)
      guard existing.deviceID == deviceID, existing.transition == observation.transition,
        existing.observedAtMS == observation.observedAtMS,
        existing.timezoneID == observation.timezoneID,
        existing.competitionEpochID == observation.competitionEpochID,
        existing.generation == current
      else { throw StoreError.identityConflict }
      return RecordingReceipt(event: existing, wasRetry: true)
    }
    if let row = try database.rows(
      "SELECT payload_json FROM captured_observations WHERE event_id=?",
      [.text(observation.id.canonical)]
    ).first {
      let existing: TrackingEvent = try decode(row["payload_json"]!)
      guard existing.deviceID == deviceID, existing.transition == observation.transition,
        existing.observedAtMS == observation.observedAtMS,
        existing.timezoneID == observation.timezoneID,
        existing.competitionEpochID == observation.competitionEpochID,
        existing.generation == current
      else { throw StoreError.identityConflict }
      return RecordingReceipt(event: existing, wasRetry: true)
    }
    let sequence = try nextSequence()
    guard sequence < TrackingReducer.maximumInteger else { throw StoreError.exhaustedSequence }
    try database.execute(
      "UPDATE setup_attempt SET status='expired' WHERE status='waiting' AND expires_at_ms<=?",
      [.integer(nowMS)])
    let attempt = try database.rows(
      """
      SELECT attempt_id FROM setup_attempt WHERE device_id=? AND generation_id=?
      AND status='waiting' AND expected_transition=? AND baseline_sequence<? AND expires_at_ms>?
      """,
      [
        .text(deviceID.canonical), .text(current.resetID.canonical),
        .text(observation.transition.rawValue),
        .integer(sequence), .integer(nowMS),
      ]
    ).first?["attempt_id"]
    let event = TrackingEvent(
      schemaVersion: 1, eventID: observation.id, deviceID: deviceID,
      sequence: sequence, generation: current, observedAtMS: observation.observedAtMS,
      timezoneID: observation.timezoneID, transition: observation.transition,
      isTest: attempt != nil, competitionEpochID: observation.competitionEpochID)
    _ = try TrackingReducer.reduce(events: [event], generation: current)
    try database.execute(
      "INSERT INTO captured_observations(event_id,device_id,sequence,payload_json) VALUES (?,?,?,?)",
      [
        .text(event.eventID.canonical), .text(deviceID.canonical), .integer(sequence),
        .text(try encode(event)),
      ])
    try database.execute(
      "UPDATE source_state SET next_sequence=? WHERE device_id=?",
      [.integer(sequence + 1), .text(deviceID.canonical)])
    if let attempt {
      try database.execute(
        "UPDATE setup_attempt SET status='consumed', consumed_event_id=? WHERE attempt_id=?",
        [.text(event.eventID.canonical), .text(attempt)])
    }
    return RecordingReceipt(event: event, wasRetry: false)
  }

  private func materializeCaptureInTransaction(_ event: TrackingEvent) throws -> RecordingReceipt {
    guard event.deviceID == deviceID else { throw StoreError.installationChanged }
    guard
      try database.rows(
        "SELECT entity_id FROM quarantines WHERE entity_id=?", [.text(event.eventID.canonical)]
      ).isEmpty
    else { throw StoreError.identityConflict }
    guard event.generation == (try generation()) else { throw StoreError.staleGeneration }
    if let row = try database.rows(
      "SELECT payload_json FROM events WHERE event_id=?", [.text(event.eventID.canonical)]
    ).first {
      let existing: TrackingEvent = try decode(row["payload_json"]!)
      guard existing == event else { throw StoreError.identityConflict }
      return RecordingReceipt(event: existing, wasRetry: true)
    }
    try insert(event)
    try enqueue("mirror_event", entity: event.eventID, generation: event.generation)
    if !event.isTest, let epoch = event.competitionEpochID, epoch == (try competitionEpoch()) {
      try enqueue("competition_event", entity: event.eventID, generation: event.generation)
    }
    if !event.isTest { try enqueueAnalyticsInTransaction(Self.analyticsEvent(event)) }
    return RecordingReceipt(event: event, wasRetry: false)
  }

  public func claimCapturedObservation(nowMS: Int64) throws -> CaptureLease? {
    try validateTime(nowMS)
    guard nowMS <= TrackingReducer.maximumInteger - 30_000 else { throw StoreError.invalidInput }
    return try journalTransaction {
      guard
        let head = try database.rows(
          "SELECT * FROM captured_observations WHERE state='pending' ORDER BY sequence LIMIT 1"
        ).first
      else { return nil }
      let due = Int64(head["next_attempt_ms"] ?? "0") ?? 0
      let leasedUntil = Int64(head["lease_until_ms"] ?? "0") ?? 0
      guard due <= nowMS || due > nowMS + 300_000,
        leasedUntil <= nowMS || leasedUntil > nowMS + 30_000
      else { return nil }
      let event: TrackingEvent = try decode(head["payload_json"]!)
      let token = UUID()
      try database.execute(
        "UPDATE captured_observations SET lease_token=?,lease_until_ms=? WHERE event_id=?",
        [.text(token.canonical), .integer(nowMS + 30_000), .text(event.eventID.canonical)])
      return CaptureLease(event: event, token: token)
    }
  }

  /// The queue row remains until local post-commit work acknowledges it. A kill after
  /// this transaction replays the same immutable event and cannot award another fold.
  public func commitCapturedObservation(_ lease: CaptureLease, nowMS: Int64) throws
    -> RecordingReceipt
  {
    try journalTransaction {
      try requireCaptureLease(lease, nowMS: nowMS)
      return try materializeCaptureInTransaction(lease.event)
    }
  }

  public func acknowledgeCapturedObservation(_ lease: CaptureLease) throws {
    try journalTransaction {
      guard
        let row = try database.rows(
          "SELECT payload_json FROM events WHERE event_id=?", [.text(lease.event.eventID.canonical)]
        ).first,
        (try decode(row["payload_json"]!) as TrackingEvent) == lease.event
      else { throw StoreError.invalidInput }
      try database.execute(
        "DELETE FROM captured_observations WHERE event_id=? AND lease_token=?",
        [.text(lease.event.eventID.canonical), .text(lease.token.canonical)])
    }
  }

  public func retryCapturedObservation(
    _ lease: CaptureLease, nowMS: Int64, quarantine: Bool = false
  ) throws {
    try validateTime(nowMS)
    try journalTransaction {
      guard
        let row = try database.rows(
          "SELECT attempt_count FROM captured_observations WHERE event_id=? AND lease_token=?",
          [.text(lease.event.eventID.canonical), .text(lease.token.canonical)]
        ).first
      else { return }
      let attempts = min((Int(row["attempt_count"] ?? "0") ?? 0) + 1, 30)
      let delay: Int64 = min(300_000, 1000 << min(attempts - 1, 9))
      try database.execute(
        "UPDATE captured_observations SET state=?,attempt_count=?,next_attempt_ms=?,lease_token=NULL,lease_until_ms=NULL,last_error=? WHERE event_id=? AND lease_token=?",
        [
          .text(quarantine ? "quarantined" : "pending"), .integer(Int64(attempts)),
          .integer(min(TrackingReducer.maximumInteger, nowMS + delay)),
          .text(quarantine ? "invalid_capture" : "storage_retry"),
          .text(lease.event.eventID.canonical), .text(lease.token.canonical),
        ])
    }
  }

  public func captureRetryStatus() throws -> CaptureRetryStatus {
    try journalTransaction(write: false) {
      let rows = try database.rows(
        "SELECT state,count(*) AS n FROM captured_observations GROUP BY state")
      return CaptureRetryStatus(
        pending: Int(rows.first { $0["state"] == "pending" }?["n"] ?? "0") ?? 0,
        quarantined: Int(rows.first { $0["state"] == "quarantined" }?["n"] ?? "0") ?? 0)
    }
  }

  private func requireCaptureLease(_ lease: CaptureLease, nowMS: Int64) throws {
    try validateTime(nowMS)
    guard
      let row = try database.rows(
        "SELECT * FROM captured_observations WHERE event_id=? AND state='pending' AND lease_token=? AND lease_until_ms>?",
        [.text(lease.event.eventID.canonical), .text(lease.token.canonical), .integer(nowMS)]
      ).first,
      (try decode(row["payload_json"]!) as TrackingEvent) == lease.event
    else { throw CaptureError.invalidLease }
  }
}
