import FoldingDomain
import Foundation

extension TrackingStore {
  /// Called only with the confirmed enrollment response; this is local state, not server authorization.
  public func setCompetitionEpoch(_ epoch: UUID?) throws {
    try journalTransaction { try setCompetitionEpochInTransaction(epoch) }
  }

  func setCompetitionEpochInTransaction(_ epoch: UUID?) throws {
    if try competitionEpoch() != epoch {
      try database.execute("DELETE FROM settings WHERE key='competition_upload_suspended'")
      try database.execute("DELETE FROM settings WHERE key='competition_upload'")
    }
    try database.execute("DELETE FROM settings WHERE key='competition_epoch'")
    if let epoch {
      // A fresh server confirmation can restore the same enrollment after a failure.
      // Keep its immutable pending operation for a safe retry rather than leaving
      // this installation permanently paused until a transfer or history reset.
      try database.execute(
        "DELETE FROM settings WHERE key='competition_upload_suspended'")
      try database.execute(
        "INSERT INTO settings(key,value) VALUES ('competition_epoch',?)", [.text(epoch.canonical)]
      )
    } else {
      try database.execute(
        "DELETE FROM work_outbox WHERE kind IN ('competition_event','competition_reset','competition_history')"
      )
    }
    if epoch == nil {
      try database.execute("DELETE FROM settings WHERE key='competition_history_before'")
      try database.execute("DELETE FROM settings WHERE key='competition_transfer'")
    }
  }

  /// An authoritative /me response revoked this installation; retain a pending explicit handover.
  public func suspendCompetitionUpload() throws {
    try journalTransaction {
      try database.execute(
        "DELETE FROM settings WHERE key IN ('competition_epoch','competition_upload','competition_history_before')"
      )
      try database.execute(
        "DELETE FROM work_outbox WHERE kind IN ('competition_event','competition_reset','competition_history')"
      )
    }
  }

  public func currentCompetitionEpoch() throws -> UUID? {
    try journalTransaction(write: false) { try competitionEpoch() }
  }

  func competitionEpoch() throws -> UUID? {
    try database.rows("SELECT value FROM settings WHERE key='competition_epoch'").first?["value"]
      .flatMap(UUID.init(uuidString:))
  }

  /// Enabled only by an enrollment response from a service supporting original-history import.
  public func configureCompetitionHistory(beforeJoinedAtMS cutoff: Int64?) throws {
    if let cutoff { try validateTime(cutoff) }
    try journalTransaction {
      try database.execute("DELETE FROM settings WHERE key='competition_history_before'")
      if cutoff == nil {
        try database.execute("DELETE FROM work_outbox WHERE kind='competition_history'")
        if let raw = try database.rows("SELECT value FROM settings WHERE key='competition_upload'")
          .first?["value"],
          let upload = try? decode(raw) as CompetitionUpload, upload.isHistory == true
        {
          try database.execute("DELETE FROM settings WHERE key='competition_upload'")
        }
      }
      if let cutoff, try competitionEpoch() != nil {
        try database.execute(
          "INSERT INTO settings(key,value) VALUES('competition_history_before',?)",
          [.text(String(cutoff))])
      }
    }
  }

  private func queueCompetitionHistory(_ current: ResetGeneration) throws {
    guard
      let raw = try database.rows(
        "SELECT value FROM settings WHERE key='competition_history_before'"
      ).first?["value"],
      let cutoff = Int64(raw)
    else { return }
    let selection = try PrivateTransferPolicy.winner(transferMarkersInTransaction())
    let watermarks = selection?.sourceWatermarks ?? [:]
    let json = try encode(
      Dictionary(uniqueKeysWithValues: watermarks.map { ($0.key.canonical, $0.value) }))
    let rows = try database.rows(
      """
      SELECT e.event_id FROM events e
      WHERE e.generation_revision=? AND e.generation_id=? AND e.competition_epoch_id IS NULL
      AND e.is_test=0 AND e.observed_at_ms<?
      AND NOT EXISTS(SELECT 1 FROM work_outbox w WHERE w.kind='competition_history' AND w.entity_id=e.event_id)
      AND NOT EXISTS(SELECT 1 FROM quarantines q WHERE q.entity_id=e.event_id)
      AND NOT EXISTS(SELECT 1 FROM entry_deletions d,json_each(d.payload_json,'$.eventIDs') v WHERE lower(v.value)=e.event_id)
      AND (?='' OR e.device_id=? OR e.sequence<=COALESCE((SELECT value FROM json_each(?) WHERE key=e.device_id),0))
      ORDER BY e.device_id,e.sequence LIMIT 256
      """,
      [
        .integer(current.revision), .text(current.resetID.canonical), .integer(cutoff),
        .text(selection?.activeDeviceID.canonical ?? ""),
        .text(selection?.activeDeviceID.canonical ?? ""), .text(json),
      ])
    for row in rows {
      guard let id = row["event_id"].flatMap(UUID.init(uuidString:)) else {
        throw StoreError.invalidInput
      }
      try enqueue("competition_history", entity: id, generation: current)
    }
  }

  /// Bounded diagnostic metadata; never exposes event bodies, identifiers or credentials.
  public func competitionUploadQueueState(nowMS: Int64) throws -> CompetitionUploadQueueState {
    try validateTime(nowMS)
    return try journalTransaction(write: false) {
      guard let epoch = try competitionEpoch() else { return .notJoined }
      if try !database.rows("SELECT value FROM settings WHERE key='competition_upload_suspended'")
        .isEmpty
      {
        return .paused
      }
      if let raw = try database.rows("SELECT value FROM settings WHERE key='competition_upload'")
        .first?["value"]
      {
        guard let work = try? decode(raw) as CompetitionUpload else { return .unreadable }
        let current = try generation()
        if work.epochID == epoch && work.generation == current {
          if work.leaseUntilMS > nowMS { return .leased }
          if work.nextAttemptMS > nowMS { return .retryWait }
          return .ready
        }
      }
      let pending = try database.rows(
        "SELECT 1 FROM work_outbox WHERE kind IN ('competition_event','competition_history','competition_reset') AND state='pending' LIMIT 1"
      )
      if pending.isEmpty { return .empty }
      let reset = try database.rows(
        "SELECT 1 FROM work_outbox WHERE kind='competition_reset' AND state='pending' LIMIT 1")
      if reset.isEmpty,
        let raw = try database.rows(
          "SELECT value FROM settings WHERE key='competition_upload_not_before'"
        ).first?["value"],
        let deadline = Int64(raw), deadline > nowMS
      {
        return .retryWait
      }
      return .ready
    }
  }

  public func leaseCompetitionUpload(nowMS: Int64) throws -> CompetitionUpload? {
    try validateTime(nowMS)
    return try journalTransaction {
      guard let epoch = try competitionEpoch() else { return nil }
      guard
        try database.rows("SELECT value FROM settings WHERE key='competition_upload_suspended'")
          .isEmpty
      else { return nil }
      let current = try generation()
      if let value = try database.rows("SELECT value FROM settings WHERE key='competition_upload'")
        .first?["value"]
      {
        var pending: CompetitionUpload = try decode(value)
        if pending.epochID == epoch && pending.generation == current {
          guard pending.leaseUntilMS <= nowMS, pending.nextAttemptMS <= nowMS else { return nil }
          pending.leaseToken = UUID()
          pending.leaseUntilMS = nowMS + 60_000
          try saveCompetitionUpload(pending)
          return pending
        }
        try database.execute("DELETE FROM settings WHERE key='competition_upload'")
      }
      let resets = try database.rows(
        "SELECT work_id FROM work_outbox WHERE kind='competition_reset' AND generation_id=? AND state='pending' LIMIT 1",
        [.text(current.resetID.canonical)])
      if resets.isEmpty,
        let value = try database.rows(
          "SELECT value FROM settings WHERE key='competition_upload_not_before'"
        ).first?["value"],
        let notBefore = Int64(value), notBefore > nowMS
      {
        return nil
      }
      let operation = UUID()
      let body: Data
      let workIDs: [UUID]
      let eventIDs: [UUID]
      let isReset = !resets.isEmpty
      var isHistory = false
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
      if let reset = resets.first {
        struct Request: Encodable {
          let schemaVersion = 1
          let operationID: String
          let epochID: String
          let generation: ResetGeneration
          enum CodingKeys: String, CodingKey {
            case schemaVersion = "schema_version"
            case operationID = "operation_id"
            case epochID = "epoch_id"
            case generation
          }
        }
        body = try encoder.encode(
          Request(operationID: operation.canonical, epochID: epoch.canonical, generation: current))
        workIDs = [UUID(uuidString: reset["work_id"]!)!]
        eventIDs = []
      } else {
        try queueCompetitionHistory(current)
        isHistory = try !database.rows(
          "SELECT work_id FROM work_outbox WHERE kind='competition_history' AND generation_id=? AND state='pending' LIMIT 1",
          [.text(current.resetID.canonical)]
        ).isEmpty
        let rows = try database.rows(
          "SELECT w.work_id,e.payload_json FROM work_outbox w JOIN events e ON e.event_id=w.entity_id WHERE w.kind=? AND w.generation_id=? AND w.state='pending' ORDER BY e.device_id,e.sequence LIMIT 256",
          [
            .text(isHistory ? "competition_history" : "competition_event"),
            .text(current.resetID.canonical),
          ])
        var events: [TrackingEvent] = []
        var ids: [UUID] = []
        for row in rows {
          let event: TrackingEvent = try decode(row["payload_json"]!)
          let workID = UUID(uuidString: row["work_id"]!)!
          guard !event.isTest,
            isHistory
              ? event.competitionEpochID == nil
              : (event.competitionEpochID == epoch && event.deviceID == deviceID)
          else {
            try database.execute(
              "UPDATE work_outbox SET state='superseded' WHERE work_id=?", [.text(workID.canonical)]
            )
            continue
          }
          events.append(event)
          ids.append(workID)
        }
        guard !events.isEmpty else { return nil }
        struct Request: Encodable {
          let schemaVersion = 1
          let operationID: String
          let epochID: String
          let events: [TrackingEvent]
          enum CodingKeys: String, CodingKey {
            case schemaVersion = "schema_version"
            case operationID = "operation_id"
            case epochID = "epoch_id"
            case events
          }
        }
        body = try encoder.encode(
          Request(operationID: operation.canonical, epochID: epoch.canonical, events: events))
        workIDs = ids
        eventIDs = events.map(\.eventID)
      }
      guard body.count <= 256 * 1024 else { throw StoreError.invalidInput }
      var upload = CompetitionUpload(
        operationID: operation, epochID: epoch, generation: current,
        isReset: isReset, body: body, eventIDs: eventIDs, workIDs: workIDs,
        leaseToken: UUID(), leaseUntilMS: nowMS + 60_000, nextAttemptMS: nowMS)
      upload.isHistory = isHistory
      try saveCompetitionUpload(upload)
      try database.execute(
        "INSERT INTO settings(key,value) VALUES('competition_upload_not_before',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [.text(String(nowMS + 60_000))])
      return upload
    }
  }

  public func acknowledgeCompetitionUpload(_ upload: CompetitionUpload, dispositions: [String])
    throws
  {
    try journalTransaction {
      guard try validCompetitionUpload(upload) else { return }
      guard upload.isReset ? dispositions.isEmpty : dispositions.count == upload.workIDs.count,
        dispositions.allSatisfy({
          ["accepted", "duplicate", "quarantined", "rejected"].contains($0)
        })
      else { throw StoreError.invalidInput }
      for (index, workID) in upload.workIDs.enumerated() {
        try database.execute(
          "UPDATE work_outbox SET state=? WHERE work_id=?",
          [.text(upload.isReset ? "acknowledged" : dispositions[index]), .text(workID.canonical)])
      }
      try database.execute("DELETE FROM settings WHERE key='competition_upload'")
    }
  }

  public func retryCompetitionUpload(
    _ upload: CompetitionUpload, atMS: Int64,
    reason: TrackingDiagnosticEntry.Reason? = nil, incrementAttempts: Bool = true
  ) throws {
    try validateTime(atMS)
    try journalTransaction {
      guard try validCompetitionUpload(upload) else { return }
      var pending = upload
      pending.attempts = min((pending.attempts ?? 0) + (incrementAttempts ? 1 : 0), 20)
      pending.retryReason = reason
      pending.nextAttemptMS = atMS
      pending.leaseUntilMS = 0
      try saveCompetitionUpload(pending)
    }
  }

  /// Migrate local retry waits to the one-minute policy. A user-requested refresh can
  /// retry immediately; explicit server cooldowns remain owned by the transport.
  /// Unknown or server-derived queue deadlines are preserved.
  public func resumeLocalCompetitionUpload(nowMS: Int64, retryNow: Bool = false) throws {
    try validateTime(nowMS)
    try journalTransaction {
      guard
        let raw = try database.rows("SELECT value FROM settings WHERE key='competition_upload'")
          .first?["value"], var work = try? decode(raw) as CompetitionUpload,
        work.leaseUntilMS <= nowMS, work.nextAttemptMS > nowMS
      else { return }
      var reason = work.retryReason
      if reason == nil {
        let raw = try database.rows(
          "SELECT value FROM settings WHERE key='tracking_diagnostics_v1'"
        )
        .first?["value"]
        let entries = TrackingDiagnosticEntry.stored(raw)
        let last = entries.last {
          [
            .uploadDeferred, .uploadAccepted, .uploadCancelled,
            .uploadQueueFailed, .uploadRuntimeFailed,
          ].contains($0.event)
        }
        if last?.event == .uploadDeferred,
          last?.reason != .busy || last?.detail == nil
        {
          reason = last?.reason
        }
      }
      guard let reason, [.busy, .network, .unauthorized, .unavailable].contains(reason) else {
        return
      }
      let nextAttemptMS =
        reason == .busy || retryNow ? nowMS : min(work.nextAttemptMS, nowMS + 60_000)
      guard nextAttemptMS != work.nextAttemptMS || reason != work.retryReason else { return }
      work.nextAttemptMS = nextAttemptMS
      work.retryReason = reason
      try saveCompetitionUpload(work)
    }
  }

  /// Preserve personal events and the immutable operation while stopping a terminal
  /// public failure. A new confirmed enrollment or reset explicitly clears this fence.
  public func stopCompetitionUpload(_ upload: CompetitionUpload, reason: String) throws {
    try journalTransaction {
      guard try validCompetitionUpload(upload) else { return }
      try database.execute(
        "INSERT INTO settings(key,value) VALUES('competition_upload_suspended',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [.text(reason)])
    }
  }

  public func hasPendingCompetitionReset() throws -> Bool {
    try journalTransaction(write: false) {
      try !database.rows(
        "SELECT work_id FROM work_outbox WHERE kind='competition_reset' AND state='pending' LIMIT 1"
      ).isEmpty
    }
  }

  public func pendingCompetitionEventCount() throws -> Int {
    try journalTransaction(write: false) {
      Int(
        try database.rows(
          "SELECT COUNT(*) AS count FROM work_outbox WHERE kind IN ('competition_event','competition_history') AND state='pending'"
        ).first?["count"] ?? "0") ?? 0
    }
  }

  private func saveCompetitionUpload(_ upload: CompetitionUpload) throws {
    try database.execute(
      "INSERT INTO settings(key,value) VALUES('competition_upload',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [.text(try encode(upload))])
  }

  private func validCompetitionUpload(_ upload: CompetitionUpload) throws -> Bool {
    guard try generation() == upload.generation, try competitionEpoch() == upload.epochID,
      let value = try database.rows("SELECT value FROM settings WHERE key='competition_upload'")
        .first?["value"]
    else { return false }
    let current: CompetitionUpload = try decode(value)
    return current.operationID == upload.operationID && current.leaseToken == upload.leaseToken
  }
}
