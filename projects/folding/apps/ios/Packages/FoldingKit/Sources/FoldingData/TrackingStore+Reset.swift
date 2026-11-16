import FoldingDomain
import Foundation

extension TrackingStore {
  /// Import never allocates a local sequence or creates public submission work.
  public func importEvent(_ event: TrackingEvent) throws {
    _ = try TrackingReducer.reduce(events: [event], generation: event.generation)
    try journalTransaction { try importEventInTransaction(event) }
  }

  func importEventInTransaction(_ event: TrackingEvent) throws {
    let current = try generation()
    if event.generation < current { return }
    guard event.generation == current else { throw StoreError.staleGeneration }
    if let row = try database.rows(
      "SELECT payload_json FROM events WHERE event_id=?", [.text(event.eventID.canonical)]
    ).first {
      let old: TrackingEvent = try decode(row["payload_json"]!)
      guard old == event else { throw StoreError.identityConflict }
      return
    }
    guard
      try database.rows(
        "SELECT event_id FROM events WHERE device_id=? AND sequence=?",
        [.text(event.deviceID.canonical), .integer(event.sequence)]
      ).isEmpty
    else { throw StoreError.identityConflict }
    try insert(event)
    // A mirror replay from this installation must not let the allocator reuse a sequence.
    if event.deviceID == deviceID {
      guard event.sequence < TrackingReducer.maximumInteger else {
        throw StoreError.exhaustedSequence
      }
      try database.execute(
        "UPDATE source_state SET next_sequence=MAX(next_sequence,?) WHERE device_id=?",
        [.integer(event.sequence + 1), .text(deviceID.canonical)])
    }
  }

  /// Capture once and retain this immutable marker across retries.
  public func interruption(reason: InterruptionReason, nowMS: Int64) throws -> TrackingInterruption
  {
    try validateTime(nowMS)
    return try journalTransaction(write: false) {
      TrackingInterruption(
        interruptionID: UUID(), deviceID: deviceID, generation: try generation(),
        afterSequence: try nextSequence() - 1, reason: reason, observedAtMS: nowMS)
    }
  }

  public func recordInterruption(_ marker: TrackingInterruption) throws {
    _ = try TrackingReducer.reduce(
      events: [], interruptions: [marker], generation: marker.generation)
    try journalTransaction {
      guard marker.generation == (try generation()) else { throw StoreError.staleGeneration }
      guard marker.deviceID == deviceID, marker.afterSequence < (try nextSequence()) else {
        throw StoreError.invalidInput
      }
      if let row = try database.rows(
        "SELECT payload_json FROM interruptions WHERE interruption_id=?",
        [.text(marker.interruptionID.canonical)]
      ).first {
        let existing: TrackingInterruption = try decode(row["payload_json"]!)
        guard existing == marker else { throw StoreError.identityConflict }
        return
      }
      try database.execute(
        "INSERT INTO interruptions VALUES (?,?,?,?,?)",
        [
          .text(marker.interruptionID.canonical), .text(deviceID.canonical),
          .text(marker.generation.resetID.canonical), .integer(marker.afterSequence),
          .text(try encode(marker)),
        ])
      try enqueue(
        "mirror_interruption", entity: marker.interruptionID, generation: marker.generation)
    }
  }

  func highestResetRevision() throws -> Int64 {
    let remembered =
      Int64(
        try database.rows("SELECT value FROM settings WHERE key='highest_reset_revision'").first?[
          "value"] ?? "0") ?? 0
    return max(remembered, try generation().revision)
  }

  func rememberResetRevision(_ revision: Int64, rejected: Bool = false) throws {
    let key = rejected ? "highest_rejected_reset_revision" : "highest_reset_revision"
    try database.execute(
      "INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=CAST(MAX(CAST(value AS INTEGER),CAST(excluded.value AS INTEGER)) AS TEXT)",
      [.text(key), .text(String(revision))])
  }

  public func reset(id: UUID = UUID(), nowMS: Int64) throws
    -> ResetGeneration
  {
    try validateTime(nowMS)
    return try journalTransaction {
      guard
        try database.rows(
          "SELECT reset_id FROM rejected_reset_ids WHERE reset_id=?", [.text(id.canonical)]
        ).isEmpty
      else { throw StoreError.identityConflict }
      if let row = try database.rows(
        "SELECT revision FROM reset_markers WHERE reset_id=?", [.text(id.canonical)]
      ).first,
        let revision = Int64(row["revision"]!)
      {
        return ResetGeneration(revision: revision, resetID: id)
      }
      let previousRevision = try highestResetRevision()
      guard
        previousRevision < TrackingReducer.maximumInteger && id != ResetGeneration.initial.resetID
      else { throw StoreError.invalidInput }
      let marker = ResetGeneration(revision: previousRevision + 1, resetID: id)
      try adoptReset(marker, nowMS: nowMS)
      try enqueue("mirror_reset", entity: id, generation: marker)
      return marker
    }
  }

  public func importReset(_ marker: ResetGeneration, createdAtMS: Int64) throws {
    try validateTime(createdAtMS)
    _ = try TrackingReducer.reduce(events: [], generation: marker)
    guard marker.revision > 0 else { throw StoreError.invalidInput }
    _ = try importMirrorBatch(
      [.reset(marker, createdAtMS: createdAtMS)], storeID: "direct-reset", checkpoint: nil)
  }

  public func importInterruption(_ marker: TrackingInterruption) throws {
    _ = try TrackingReducer.reduce(
      events: [], interruptions: [marker], generation: marker.generation)
    try journalTransaction { try importInterruptionInTransaction(marker) }
  }

  func importInterruptionInTransaction(_ marker: TrackingInterruption) throws {
    let current = try generation()
    if marker.generation < current { return }
    guard marker.generation == current else { throw StoreError.staleGeneration }
    if let row = try database.rows(
      "SELECT payload_json FROM interruptions WHERE interruption_id=?",
      [.text(marker.interruptionID.canonical)]
    ).first {
      let old: TrackingInterruption = try decode(row["payload_json"]!)
      guard old == marker else { throw StoreError.identityConflict }
      return
    }
    try database.execute(
      "INSERT INTO interruptions VALUES (?,?,?,?,?)",
      [
        .text(marker.interruptionID.canonical), .text(marker.deviceID.canonical),
        .text(marker.generation.resetID.canonical), .integer(marker.afterSequence),
        .text(try encode(marker)),
      ])
  }

  func adoptReset(_ marker: ResetGeneration, nowMS: Int64) throws {
    try database.execute("DELETE FROM settings WHERE key='competition_upload_suspended'")
    try rememberResetRevision(marker.revision)
    if let row = try database.rows(
      "SELECT revision,created_at_ms FROM reset_markers WHERE reset_id=?",
      [.text(marker.resetID.canonical)]
    ).first {
      guard row["revision"] == String(marker.revision), row["created_at_ms"] == String(nowMS) else {
        throw StoreError.identityConflict
      }
      return
    }
    let old = try generation()
    try database.execute(
      "INSERT INTO reset_markers VALUES (?,?,?)",
      [.text(marker.resetID.canonical), .integer(marker.revision), .integer(nowMS)])
    guard marker > old else { return }
    try database.execute("DELETE FROM settings WHERE key='tracking_diagnostics_v1'")
    exportPurgePending = true
    try database.execute("DELETE FROM settings WHERE key='competition_upload'")
    try cancelDailyLimitWorkInTransaction()
    try database.execute("DELETE FROM events")
    try database.execute("DELETE FROM captured_observations")
    try database.execute("DELETE FROM interruptions")
    try database.execute("DELETE FROM entry_deletions")
    try database.execute("DELETE FROM setup_attempt")
    try database.execute("DELETE FROM quarantines")
    try database.execute(
      "DELETE FROM work_outbox WHERE kind NOT IN ('mirror_reset','mirror_transfer')")
    if try competitionEpoch() != nil {
      try enqueue("competition_reset", entity: marker.resetID, generation: marker)
    }
  }
}
